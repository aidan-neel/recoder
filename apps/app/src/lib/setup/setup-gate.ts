'use client';

import { useEffect } from 'react';
import { create, useStore } from 'zustand';

import { useListStore } from '../api/client';
import { useSettings } from '../settings/settings-store';
import { useChecklist } from './checklist-store';
import { gateOf } from './setup-steps';

/** Whether the pull request list can show yet: `needed` until the server says setup is finished. */
export type SetupGate = 'checking' | 'needed' | 'done';

interface GateState {
	/** True while the checklist is on screen, so the gate stays `needed` through its closing beat. */
	holding: boolean;
	/**
	 * The reload of the checklist and settings after the server came back:
	 * `spent` once it ran and they still failed, so the gate stops waiting on them.
	 */
	retry: 'idle' | 'running' | 'spent';
}

const useGate = create<GateState>(() => ({ holding: false, retry: 'idle' }));

/** The checklist holds the gate while it shows, and lets go once setup has finished and faded. */
export function holdSetup(holding: boolean): void {
	useGate.setState({ holding });
}

/** True while the checklist or the settings failed to load: the server was down or answered with an error. */
function setupDown(): boolean {
	const checklist = useChecklist.getState().status;

	return useSettings.getState().status === 'offline' || checklist === 'offline' || checklist === 'error';
}

/** Loads the checklist and the settings again once the server answers, then lets the gate decide. */
async function recover(): Promise<void> {
	useGate.setState({ retry: 'running' });
	await Promise.allSettled([useSettings.getState().load(true), useChecklist.getState().load()]);
	useGate.setState({ retry: setupDown() ? 'spent' : 'idle' });
}

/** Checks everything again: the checklist, and the agent, providers and models its steps show. */
export function recheckSetup(): void {
	void useChecklist.getState().load();
	void useSettings.getState().load(true);
}

/**
 * Reads whether setup is finished. It loads the checklist and the settings on mount; while the checklist is up, it
 * checks again whenever the window regains focus, since a provider or a certificate can arrive from elsewhere. When
 * the server was down on load and the pull request list then reaches it, both load again, so the checklist can
 * still appear.
 */
export function useSetupGate(): SetupGate {
	const steps = useChecklist((state) => state.checklist);
	const checklist = useChecklist((state) => state.status);
	const settings = useSettings((state) => state.status);
	const holding = useGate((state) => state.holding);
	const retry = useGate((state) => state.retry);
	const answered = useStore(useListStore().state, (state) => state.phase === 'ready');
	const down = settings === 'offline' || checklist === 'offline' || checklist === 'error';
	const recovering = down && answered && retry !== 'spent';
	const gate = gateOf({ checklist, settings, steps, holding, recovering });
	const showing = gate === 'needed';

	useEffect(() => {
		void useSettings.getState().load();
		void useChecklist.getState().load();
	}, []);

	useEffect(() => {
		if (down && answered && retry === 'idle') void recover();
	}, [down, answered, retry]);

	useEffect(() => {
		if (!showing) return;

		window.addEventListener('focus', recheckSetup);

		return () => window.removeEventListener('focus', recheckSetup);
	}, [showing]);

	return gate;
}
