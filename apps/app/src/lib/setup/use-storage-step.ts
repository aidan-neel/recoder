'use client';

import type { StorageTest } from '@recoder/shared';
import type { ButtonStatus } from '@recoder/ui';
import { useState } from 'react';

import { failureText } from '../api/http';
import { setupApi } from '../api/setup';
import { useAction } from '../shell/use-action';
import { useChecklist } from './checklist-store';

/** The PostgreSQL dialog: a URL to try, then the offline move the docs describe. */
export interface PostgresDialog {
	open: boolean;
	setOpen: (open: boolean) => void;
	url: string;
	setUrl: (url: string) => void;
	test: () => void;
	testStatus: ButtonStatus;
	/** The last test's answer for the URL in the field; null before one. */
	tested: StorageTest | null;
	/** Why the test was refused, or what the database answered. */
	error: string | null;
}

/** Everything the storage step shows and does. */
export interface StorageStepView {
	useBuiltin: () => void;
	builtinStatus: ButtonStatus;
	postgres: PostgresDialog;
}

/**
 * The storage step. The built-in database finishes it. PostgreSQL can be tried here, but a running install cannot
 * switch to it from the browser: the move is an offline import, so the dialog tests the URL and then shows the steps.
 */
export function useStorageStep(): StorageStepView {
	const builtin = useAction();
	const [open, setOpen] = useState(false);
	const [url, setUrlText] = useState('');
	const [tested, setTested] = useState<StorageTest | null>(null);
	const [testStatus, setTestStatus] = useState<ButtonStatus>('idle');
	const [error, setError] = useState<string | null>(null);

	async function test(): Promise<void> {
		setTestStatus('pending');
		setError(null);

		try {
			const answer = await setupApi.testStorage(url.trim());

			setTested(answer);
			setTestStatus(answer.ok ? 'success' : 'idle');
		} catch (failure) {
			setError(failureText(failure, 'The database was not tried.'));
			setTestStatus('idle');
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
			test: () => void test(),
			testStatus,
			tested,
			error: error ?? (tested && !tested.ok ? (tested.error ?? 'PostgreSQL did not answer.') : null)
		}
	};
}
