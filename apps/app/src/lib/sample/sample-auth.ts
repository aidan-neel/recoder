import type { Account, AuthState, DeviceSignIn, LinkedForge, SignInForge, StartDeviceSignIn } from '@recoder/shared';

import type { AuthApi } from '../api/accounts';

/** Polls the sample's sign-in answers `pending` for before it says `signed-in`. */
const PENDING_POLLS = 2;

/** The seconds between polls the sample asks for. */
const POLL_SECONDS = 1;

const SAMPLE_AT = '2026-11-01T09:00:00.000Z';

function sampleForge(provider: SignInForge): LinkedForge {
	return { provider, host: null, login: 'you', name: 'Sample person', avatarUrl: null, linkedAt: SAMPLE_AT };
}

/**
 * The sample's account: a person signed in with GitHub, who can link GitLab
 * through a sign-in that finishes after a couple of polls. Nothing leaves the
 * page, and the sample is never signed out.
 */
export function createSampleAuth(): AuthApi {
	const forges: LinkedForge[] = [sampleForge('github')];
	let pending: { provider: SignInForge; polls: number } | null = null;

	function account(): Account {
		return {
			id: 'sample',
			role: 'admin',
			name: 'Sample person',
			avatarUrl: null,
			forges: [...forges],
			createdAt: SAMPLE_AT
		};
	}

	return {
		me: async (): Promise<AuthState> => ({
			account: account(),
			setup: false,
			connected: [],
			setupLocked: false,
			forges: [
				{ provider: 'github', method: 'device' },
				{ provider: 'gitlab', method: 'device' }
			]
		}),

		async startSignIn(input: StartDeviceSignIn): Promise<DeviceSignIn> {
			pending = { provider: input.provider, polls: 0 };

			return {
				attemptId: 'sample-attempt',
				userCode: 'WDJB-MJHT',
				verificationUri: 'https://recoder.dev/sample',
				interval: POLL_SECONDS,
				expiresAt: new Date(Date.now() + 15 * 60_000).toISOString()
			};
		},

		async signInState() {
			if (!pending) return { state: 'expired' };

			pending.polls += 1;

			if (pending.polls <= PENDING_POLLS) return { state: 'pending' };

			if (!forges.some((forge) => forge.provider === pending?.provider)) forges.push(sampleForge(pending.provider));

			pending = null;

			return { state: 'signed-in', account: account() };
		},

		unlockSetup: async () => {},

		adopt: async () => ({ account: account() }),

		signOut: async () => {}
	};
}
