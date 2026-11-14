'use client';

import type { SignInForge, StartDeviceSignIn } from '@recoder/shared';
import { useState } from 'react';

import { readGitlabHost } from './gitlab-host';

/** What the forge buttons show and do, with GitLab's optional self-managed host. */
export interface ForgeChoicesView {
	/** The GitLab host field is showing. */
	hostOpen: boolean;
	host: string;
	/** Why the typed host cannot be one; null while it can. */
	hostError: string | null;
	toggleHost: () => void;
	setHost: (host: string) => void;
	/** Hands `begin` the forge to sign in with; GitLab takes the typed host and refuses one that cannot be a host. */
	choose: (provider: SignInForge, begin: (input: StartDeviceSignIn) => void) => void;
}

/** The forge choice: GitHub begins at once, GitLab with the host the person revealed and typed, if any. */
export function useForgeChoices(): ForgeChoicesView {
	const [hostOpen, setHostOpen] = useState(false);
	const [host, setHostText] = useState('');
	const [hostError, setHostError] = useState<string | null>(null);

	function choose(provider: SignInForge, begin: (input: StartDeviceSignIn) => void): void {
		if (provider === 'github') {
			begin({ provider });

			return;
		}

		const typed = readGitlabHost(hostOpen ? host : '');

		if ('error' in typed) {
			setHostError(typed.error);

			return;
		}

		begin(typed.host ? { provider, host: typed.host } : { provider });
	}

	return {
		hostOpen,
		host,
		hostError,
		toggleHost: () => {
			setHostOpen((open) => !open);
			setHostError(null);
		},
		setHost: (value) => {
			setHostText(value);
			setHostError(null);
		},
		choose
	};
}
