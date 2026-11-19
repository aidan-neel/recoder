'use client';

import type { ServerChecks } from '@recoder/shared';
import { useEffect, useState } from 'react';

import { failureText } from '../api/http';
import { serverApi } from '../api/server';

/** How often the checks are read while a run is in flight. */
const POLL_MS = 1000;

/** The server's checks as a screen shows them. */
export interface ChecksView {
	checks: ServerChecks | null;
	/** Why the checks could not be read or run. */
	error: string | null;
	/** True while a run is in flight. */
	running: boolean;
	/** Runs every check again, the review model's one call included. */
	run: () => void;
}

/**
 * Reads the server's checks, and runs them when `runFirst` is set (the model check makes a model call, so only a
 * run asks for it). While a run is in flight the checks are read every second until it settles.
 */
export function useChecks(runFirst: boolean): ChecksView {
	const [checks, setChecks] = useState<ServerChecks | null>(null);
	const [error, setError] = useState<string | null>(null);
	const running = checks?.running ?? false;

	function settle(read: Promise<ServerChecks>): void {
		read.then(
			(next) => {
				setChecks(next);
				setError(null);
			},
			(failure: unknown) => setError(failureText(failure, 'The checks could not run.'))
		);
	}

	useEffect(() => {
		settle(runFirst ? serverApi.runChecks() : serverApi.checks());
	}, [runFirst]);

	useEffect(() => {
		if (!running) return;

		const timer = setTimeout(() => settle(serverApi.checks()), POLL_MS);

		return () => clearTimeout(timer);
	}, [running, checks]);

	return {
		checks,
		error,
		running,
		run: () => {
			if (!running) settle(serverApi.runChecks());
		}
	};
}
