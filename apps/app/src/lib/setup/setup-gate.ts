'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { create } from 'zustand';

import { ApiError, failureText, isOffline, OFFLINE_TEXT } from '../api/http';
import { settingsApi } from '../api/settings';
import { useConnections } from '../connections/connections-store';
import { useQueue } from '../queue/queue-store';
import { rememberCount } from '../settings/last-counts';
import { useSettings } from '../settings/settings-store';
import {
	gateOf,
	parseSteps,
	setupSteps,
	stepsLeft,
	stepsOfStatus,
	type SetupCheck,
	type SetupSteps
} from './setup-steps';

/** Whether the queue can show yet: `needed` while a provider, model or repository is missing. */
export type SetupGate = 'checking' | 'needed' | 'done';

interface GateState {
	/** True while first run is on screen, so the gate stays `needed` through its closing beat. */
	holding: boolean;
	/** The steps the server's setup status reports; null until it answers. */
	status: SetupSteps | null;
	check: SetupCheck;
	/** What the failed check says, in plain words. */
	error: string | null;
	/** True once the first check has run longer than {@link WAIT_MS}; the gate stops waiting on it then. */
	waited: boolean;
	/**
	 * The check run again after the server came back: `spent` once it ran and
	 * still did not reach the server, so the gate stops waiting on it.
	 */
	retry: 'idle' | 'running' | 'spent';
}

/** Where the last steps seen are kept, so a returning person's gate decides before the check answers. */
const STORAGE_KEY = 'recoder.app.setup.v1';

/** The longest the queue waits on the setup check before it shows anyway. */
const WAIT_MS = 3000;

const useGate = create<GateState>(() => ({
	holding: false,
	status: null,
	check: 'idle',
	error: null,
	waited: false,
	retry: 'idle'
}));

const set = useGate.setState;

/** The check in flight; another asked for meanwhile joins it. */
let inflight: Promise<void> | null = null;

/** The stored steps, read once per page load; undefined until then. */
let saved: SetupSteps | null | undefined;

function readSaved(): SetupSteps | null {
	if (saved !== undefined) return saved;

	try {
		saved = parseSteps(localStorage.getItem(STORAGE_KEY));
	} catch {
		saved = null;
	}

	return saved;
}

/** Keeps the steps for the next visit. Storage that is full or blocked only costs that visit its instant decision. */
function remember(steps: SetupSteps): void {
	const text = JSON.stringify(steps);

	try {
		if (localStorage.getItem(STORAGE_KEY) !== text) localStorage.setItem(STORAGE_KEY, text);
	} catch {}
}

/** Nothing to subscribe to: the stored steps only matter until fresh ones are known. */
function subscribe(): () => void {
	return () => {};
}

/** The steps the last visit saw. A server render, and the render that hydrates it, have none. */
function useSavedSteps(): SetupSteps | null {
	return useSyncExternalStore(subscribe, readSaved, () => null);
}

/** First run holds the gate while it shows, and lets go once its last step has settled. */
export function holdSetup(holding: boolean): void {
	set({ holding });
}

/**
 * The gate's answer from a server too old for the setup status: it loads the
 * settings and the repositories, and the steps come from them (see
 * {@link useSetupSteps}).
 */
async function fallback(): Promise<void> {
	await Promise.allSettled([useSettings.getState().load(), useConnections.getState().loadRepos()]);

	const settings = useSettings.getState();
	const { reposStatus, reposError } = useConnections.getState();

	if ((settings.status === 'offline' && !settings.error) || reposStatus === 'offline') {
		return set({ check: 'offline', error: OFFLINE_TEXT });
	}

	if (settings.status === 'offline' || reposStatus === 'error') {
		return set({ check: 'failed', error: settings.error ?? reposError });
	}

	set({ check: 'ready', error: null });
}

/**
 * Asks the server for its setup status once. An empty answer (a 2xx with no
 * body) has no status to read, so it fails as an answer that could not be
 * read rather than as a crash in the page. The number of tracked
 * repositories it reports is kept, so a first visit to Settings draws that
 * many rows.
 */
async function runCheck(): Promise<void> {
	try {
		const answer = await settingsApi.status();

		if (!answer) throw new SyntaxError('The setup status came back empty.');

		rememberCount('repos', answer.repoCount);

		set({ status: stepsOfStatus(answer), check: 'ready', error: null });
	} catch (error) {
		if (error instanceof ApiError && error.status === 404) return fallback();

		set({ check: isOffline(error) ? 'offline' : 'failed', error: failureText(error) });
	}
}

/**
 * Asks the server what first run still needs: a few flags and counts, not
 * the model catalog. One check runs at a time. The first one starts the
 * bounded wait.
 */
function checkSetup(): Promise<void> {
	if (inflight) return inflight;

	if (useGate.getState().check === 'idle') setTimeout(() => set({ waited: true }), WAIT_MS);

	set({ check: 'loading' });

	const done = runCheck().finally(() => {
		if (inflight === done) inflight = null;
	});

	inflight = done;

	return done;
}

/** Checks the setup again for the queue's notice; rejects when the check still fails, so its button shows that. */
export async function checkSetupAgain(): Promise<void> {
	await checkSetup();

	const { check, error } = useGate.getState();

	if (check !== 'ready') throw new Error(error ?? OFFLINE_TEXT);
}

/** Runs the check again once the server answers the queue, then lets the gate decide. */
async function recover(): Promise<void> {
	set({ retry: 'running' });
	await checkSetup();
	set({ retry: useGate.getState().check === 'offline' ? 'spent' : 'idle' });
}

/**
 * A setup check that failed runs again once the queue recovers from a failed
 * load: the server that failed the queue likely failed the check too, so
 * the note about it would otherwise outlive the recovery. A check that never
 * reached the server runs again through {@link recover} instead.
 */
useQueue.subscribe((state, previous) => {
	const recovered = previous.error !== null && state.error === null && ['ready', 'empty'].includes(state.status);

	if (recovered && !state.sample && useGate.getState().check === 'failed') void checkSetup();
});

/** Checks everything first run shows again: the agent and its providers, the models, the repositories and the forges. Resolves once each has answered or failed. */
export async function recheckSetup(): Promise<void> {
	await Promise.allSettled([
		useSettings.getState().load(true),
		useConnections.getState().loadRepos(),
		useConnections.getState().loadAuth()
	]);
}

/**
 * First run's steps: from the settings and repositories once both have
 * loaded (first run loads them, and they change as it is worked through),
 * else from the server's setup status. Null until either is known.
 */
export function useSetupSteps(): SetupSteps | null {
	const models = useSettings((state) => state.models);
	const providers = useSettings((state) => state.providers);
	const repos = useConnections((state) => state.repos);
	const status = useGate((state) => state.status);

	return useMemo(
		() => (models && repos ? setupSteps(models, providers, repos) : status),
		[models, providers, repos, status]
	);
}

/**
 * What the queue says about a setup check it stopped waiting on: still
 * running, or failed. Null when the check answered, or when the last visit
 * saw the setup done and the queue can trust that.
 */
export function useSetupNote(): { title: string; detail: string | null; retry: boolean } | null {
	const steps = useSetupSteps();
	const remembered = useSavedSteps();
	const check = useGate((state) => state.check);
	const error = useGate((state) => state.error);
	const waited = useGate((state) => state.waited);

	if (steps || (remembered && stepsLeft(remembered) === 0)) return null;
	if (check === 'failed') return { title: 'Couldn’t check your setup.', detail: error, retry: true };
	if (check === 'loading' && waited) return { title: 'Still checking your setup.', detail: null, retry: false };

	return null;
}

/**
 * Decides whether first run takes the page. It asks the server's small
 * setup status on mount; a returning person whose setup was done gets the
 * queue at once, and nobody waits longer than {@link WAIT_MS}. When the
 * check never reached the server and the queue then does, it checks again,
 * so first run can still appear.
 */
export function useSetupGate(): SetupGate {
	const steps = useSetupSteps();
	const remembered = useSavedSteps();
	const check = useGate((state) => state.check);
	const waited = useGate((state) => state.waited);
	const holding = useGate((state) => state.holding);
	const retry = useGate((state) => state.retry);
	const answered = useQueue((state) => !state.sample && !state.restored && ['ready', 'empty'].includes(state.status));
	const down = check === 'offline';
	const recovering = retry === 'running' || (down && answered && retry === 'idle');

	useEffect(() => {
		void checkSetup();
	}, []);

	useEffect(() => {
		if (down && answered && retry === 'idle') void recover();
	}, [down, answered, retry]);

	useEffect(() => {
		if (steps) remember(steps);
	}, [steps]);

	return gateOf({ steps, saved: remembered, check, waited, holding, recovering });
}
