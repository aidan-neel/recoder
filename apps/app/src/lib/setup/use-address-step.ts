'use client';

import type { SetAddress, SetupAddress } from '@recoder/shared';
import type { ButtonStatus } from '@recoder/ui';
import { useEffect, useState } from 'react';

import { failureText } from '../api/http';
import { setupApi } from '../api/setup';
import { useChecklist } from './checklist-store';

/** How often the step reads the certificate's progress while it is being issued. */
const POLL_MS = 1500;

/** `domain`: Recoder gets the certificate. `proxy`: a proxy in front of Recoder already serves HTTPS. */
type AddressMode = 'domain' | 'proxy';

/** Everything the address step shows and does. */
export interface AddressStepView {
	mode: AddressMode;
	setMode: (mode: AddressMode) => void;
	value: string;
	setValue: (value: string) => void;
	status: ButtonStatus;
	/** Why the address did not take: DNS that points elsewhere, a refused certificate, a refused request. */
	error: string | null;
	/** The domain a certificate is being issued for, while it is. */
	issuing: string | null;
	/** The new address, once it serves HTTPS and this page is not on it yet. */
	continueAt: string | null;
	submit: () => void;
}

/** Why a domain cannot have its certificate yet, in a line. */
function addressError(address: SetupAddress): string | null {
	const { dns, tls } = address;

	if (dns && !dns.points) {
		const found = dns.found.length > 0 ? dns.found.join(', ') : 'nothing';

		return `${dns.domain} points at ${found}, not ${dns.expected.join(', ')}. Change its DNS record, then try again.`;
	}

	return tls.state === 'failed' ? (tls.error ?? 'The certificate was not issued.') : null;
}

/** The new address when it is ready and this page was opened on another one; null otherwise. */
function continueAddress(address: SetupAddress | null): string | null {
	if (!address?.publicUrl) return null;
	if (address.tls.state !== 'issued' && address.tls.state !== 'external') return null;

	return new URL(address.publicUrl).origin === window.location.origin ? null : address.publicUrl;
}

/** What the person typed, as the server takes it: a bare domain, or a proxy's full address. */
function addressBody(mode: AddressMode, value: string): SetAddress {
	const trimmed = value.trim();

	if (mode === 'proxy') return { external: /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}` };

	return { domain: trimmed.replace(/^https?:\/\//, '').replace(/\/.*$/, '') };
}

/**
 * The address step: a domain Recoder gets a certificate for, or the address of a proxy that already serves HTTPS.
 * While the certificate is issued the step reads its progress; once it is, the checklist reads again and the page
 * offers the new address, since setup goes on there.
 */
export function useAddressStep(active: boolean): AddressStepView {
	const [mode, setMode] = useState<AddressMode>('domain');
	const [value, setValue] = useState('');
	const [address, setAddress] = useState<SetupAddress | null>(null);
	const [status, setStatus] = useState<ButtonStatus>('idle');
	const [refused, setRefused] = useState<string | null>(null);
	const issuing = address?.tls.state === 'pending' ? address.tls.domain : null;

	useEffect(() => {
		if (!active) return;

		void setupApi.address().then(
			(read) => {
				setAddress(read);
				if (read.tls.domain) setValue((typed) => typed || (read.tls.domain ?? ''));
			},
			() => undefined
		);
	}, [active]);

	useEffect(() => {
		if (!issuing) return;

		const timer = setTimeout(
			() =>
				void setupApi.address().then(
					(read) => {
						setAddress(read);
						if (read.tls.state !== 'pending') void useChecklist.getState().load();
					},
					() => undefined
				),
			POLL_MS
		);

		return () => clearTimeout(timer);
	}, [issuing, address]);

	async function submit(): Promise<void> {
		if (!value.trim() || status === 'pending') return;

		setStatus('pending');
		setRefused(null);

		try {
			const read = await setupApi.setAddress(addressBody(mode, value));

			setAddress(read);
			setStatus('idle');
			if (read.tls.state !== 'pending') void useChecklist.getState().load();
		} catch (error) {
			setRefused(failureText(error, 'The address was not saved.'));
			setStatus('error');
		}
	}

	return {
		mode,
		setMode: (next) => {
			setMode(next);
			setRefused(null);
		},
		value,
		setValue: (next) => {
			setValue(next);
			if (status === 'error') setStatus('idle');
		},
		status: issuing ? 'pending' : status,
		error: refused ?? (address && !issuing ? addressError(address) : null),
		issuing,
		continueAt: continueAddress(address),
		submit: () => void submit()
	};
}
