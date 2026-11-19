'use client';

import type { StorageTest } from '@recoder/shared';
import type { ButtonStatus } from '@recoder/ui';
import { useEffect, useState } from 'react';

import { failureText } from '../api/http';
import { setupApi } from '../api/setup';
import { useAction } from '../shell/use-action';
import { useChecklist } from './checklist-store';

/** How often the checklist is read while the server restarts onto PostgreSQL. */
const MOVE_POLL_MS = 2000;

/** The PostgreSQL dialog: a URL to test, whether to copy the built-in data across, and the move. */
export interface PostgresDialog {
	open: boolean;
	setOpen: (open: boolean) => void;
	url: string;
	setUrl: (url: string) => void;
	copy: boolean;
	setCopy: (copy: boolean) => void;
	test: () => void;
	testStatus: ButtonStatus;
	/** The last test's answer for the URL in the field; null before one. */
	tested: StorageTest | null;
	move: () => void;
	moveStatus: ButtonStatus;
	/** Why the test or the move was refused. */
	error: string | null;
}

/** Everything the storage step shows and does. */
export interface StorageStepView {
	useBuiltin: () => void;
	builtinStatus: ButtonStatus;
	postgres: PostgresDialog;
	/** True while the server restarts onto PostgreSQL. */
	moving: boolean;
}

/**
 * The storage step: keep the built-in database, or move to PostgreSQL. A move restarts the server through its
 * updater, so the step reads the checklist every two seconds until the server is back and says storage is set.
 */
export function useStorageStep(done: boolean): StorageStepView {
	const builtin = useAction();
	const [open, setOpen] = useState(false);
	const [url, setUrlText] = useState('');
	const [copy, setCopy] = useState(true);
	const [tested, setTested] = useState<StorageTest | null>(null);
	const [testStatus, setTestStatus] = useState<ButtonStatus>('idle');
	const [moveStatus, setMoveStatus] = useState<ButtonStatus>('idle');
	const [error, setError] = useState<string | null>(null);
	const [moving, setMoving] = useState(false);

	useEffect(() => {
		if (!moving || done) return;

		const timer = setInterval(() => void useChecklist.getState().load(), MOVE_POLL_MS);

		return () => clearInterval(timer);
	}, [moving, done]);

	async function test(): Promise<void> {
		setTestStatus('pending');
		setError(null);

		try {
			const answer = await setupApi.testStorage(url.trim());

			setTested(answer);
			setTestStatus(answer.ok ? 'success' : 'idle');
		} catch (failure) {
			setError(failureText(failure, 'The database was not tried.'));
			setTestStatus('error');
		}
	}

	async function move(): Promise<void> {
		setMoveStatus('pending');
		setError(null);

		try {
			await setupApi.moveToPostgres(url.trim(), copy);
			setMoveStatus('idle');
			setOpen(false);
			setMoving(true);
		} catch (failure) {
			setError(failureText(failure, 'The move did not start.'));
			setMoveStatus('error');
		}
	}

	return {
		useBuiltin: () => builtin.run(async () => useChecklist.getState().take(await setupApi.useBuiltinStorage())),
		builtinStatus: builtin.status,
		postgres: {
			open,
			setOpen,
			url,
			setUrl: (next) => {
				setUrlText(next);
				setTested(null);
				setTestStatus('idle');
			},
			copy,
			setCopy,
			test: () => void test(),
			testStatus,
			tested,
			move: () => void move(),
			moveStatus,
			error: error ?? (tested && !tested.ok ? (tested.error ?? 'PostgreSQL did not answer.') : null)
		},
		moving: moving && !done
	};
}
