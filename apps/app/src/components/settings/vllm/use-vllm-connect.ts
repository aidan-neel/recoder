'use client';

import type { ButtonStatus } from '@recoder/ui';
import { useState } from 'react';

import { failureText } from '@/lib/api/http';
import { useCloseOnSuccess } from '@/lib/settings/use-close-on-success';
import { useVllm } from '@/lib/settings/vllm-store';
import { plural } from '@/lib/shell/format';
import { undoToast } from '@/lib/shell/notify';

/** The connect form's state: what was typed, and where the check of it stands. */
export interface VllmConnect {
	address: string;
	key: string;
	status: ButtonStatus;
	/** The server's reason the last attempt failed, in plain words. */
	error: string | null;
	/** The address and key are with the server: the fields hold still and the modal stays open until it answers. */
	sending: boolean;
	canSubmit: boolean;
	setAddress: (address: string) => void;
	setKey: (key: string) => void;
	submit: () => void;
}

/**
 * Connecting a vLLM server: idle, pending while the server lists the models
 * at the address, then success (the button says so for a beat, then the modal
 * closes) or an error under the address. Typing again clears an error.
 */
export function useVllmConnect(close: () => void): VllmConnect {
	const [address, setAddressText] = useState('');
	const [key, setKeyText] = useState('');
	const [status, setStatus] = useState<ButtonStatus>('idle');
	const [error, setError] = useState<string | null>(null);

	useCloseOnSuccess(status, close);

	function edited(): void {
		setError(null);
		setStatus((now) => (now === 'error' ? 'idle' : now));
	}

	const canSubmit = address.trim().length > 0;

	async function connect(): Promise<void> {
		setStatus('pending');
		setError(null);

		try {
			const server = await useVllm.getState().connect(address.trim(), key.trim());

			setStatus('success');
			undoToast(`Connected ${server.host} · ${plural(server.models.length, 'model')}`);
		} catch (failure) {
			setError(failureText(failure, 'Couldn’t connect.'));
			setStatus('error');
		}
	}

	return {
		address,
		key,
		status,
		error,
		sending: status === 'pending',
		canSubmit,
		setAddress: (value) => {
			setAddressText(value);
			edited();
		},
		setKey: (value) => {
			setKeyText(value);
			edited();
		},
		submit: () => {
			if (status === 'pending' || status === 'success' || !canSubmit) return;

			void connect();
		}
	};
}
