'use client';

import { useEffect, useMemo } from 'react';
import { create } from 'zustand';

import { useConnections } from '../connections/connections-store';
import { useQueue } from '../queue/queue-store';
import { useSettings } from '../settings/settings-store';
import { gateOf, setupSteps, stepsLeft, type SetupSteps } from './setup-steps';

/** Whether the queue can show yet: `needed` while a provider, model or repository is missing. */
export type SetupGate = 'checking' | 'needed' | 'done';

interface GateState {
	/** True while first run is on screen, so the gate stays `needed` through its closing beat. */
	holding: boolean;
	/**
	 * The reload of the settings and repositories after the server came back:
	 * `spent` once it ran and they still failed, so the gate stops waiting on them.
	 */
	retry: 'idle' | 'running' | 'spent';
}

const useGate = create<GateState>(() => ({ holding: false, retry: 'idle' }));

/** First run holds the gate while it shows, and lets go once its last step has settled. */
export function holdSetup(holding: boolean): void {
	useGate.setState({ holding });
}

/** True while the settings or the repositories have failed to load: the server was down or answered with an error. */
function setupDown(): boolean {
	const { reposStatus } = useConnections.getState();

	return useSettings.getState().status === 'offline' || reposStatus === 'offline' || reposStatus === 'error';
}

/** Loads the settings and the repositories again once the server answers, then lets the gate decide. */
async function recover(): Promise<void> {
	useGate.setState({ retry: 'running' });
	await Promise.allSettled([useSettings.getState().load(true), useConnections.getState().loadRepos()]);
	useGate.setState({ retry: setupDown() ? 'spent' : 'idle' });
}

/** Checks everything again: the agent and its providers, the models, the repositories and the forges. */
export function recheckSetup(): void {
	void useSettings.getState().load(true);
	void useConnections.getState().loadRepos();
	void useConnections.getState().loadAuth();
}

/** First run's steps, or null until the settings and the repositories have loaded. */
export function useSetupSteps(): SetupSteps | null {
	const models = useSettings((state) => state.models);
	const providers = useSettings((state) => state.providers);
	const repos = useConnections((state) => state.repos);

	return useMemo(() => (models && repos ? setupSteps(models, providers, repos) : null), [models, providers, repos]);
}

/**
 * Reads what first run still needs. It loads the settings and the tracked
 * repositories on mount, and checks the forges only when first run will show.
 * While first run is up, it checks again whenever the window regains focus.
 * When the server was down on load and the queue then reaches it, the
 * settings and repositories load again, so first run can still appear.
 */
export function useSetupGate(): SetupGate {
	const steps = useSetupSteps();
	const settings = useSettings((state) => state.status);
	const repos = useConnections((state) => state.reposStatus);
	const auth = useConnections((state) => state.authStatus);
	const holding = useGate((state) => state.holding);
	const retry = useGate((state) => state.retry);
	const answered = useQueue((state) => !state.sample && (state.status === 'ready' || state.status === 'empty'));
	const down = settings === 'offline' || repos === 'offline' || repos === 'error';
	const recovering = down && answered && retry !== 'spent';
	const gate = gateOf({ settings, repos, auth, steps, holding, recovering });
	const showing = gate === 'needed' || (steps !== null && stepsLeft(steps) > 0);

	useEffect(() => {
		void useSettings.getState().load();
		void useConnections.getState().loadRepos();
	}, []);

	useEffect(() => {
		if (down && answered && retry === 'idle') void recover();
	}, [down, answered, retry]);

	useEffect(() => {
		if (!showing) return;

		void useConnections.getState().loadAuth();
		window.addEventListener('focus', recheckSetup);

		return () => window.removeEventListener('focus', recheckSetup);
	}, [showing]);

	return gate;
}
