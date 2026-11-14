import type { DeviceSignIn } from '@recoder/shared';
import { randomBytes } from 'node:crypto';
import { ForgeOAuthError, pollDeviceToken, requestDeviceCode, type ForgeTarget, type IssuedToken } from './forge-oauth';
import { completeSignIn, type CompletedSignIn } from './sign-in';

/** How many sign-ins may wait on a person at once; each polls a forge, so an open endpoint cannot start them without end. */
const MAX_OPEN_ATTEMPTS = 20;

/** A finished attempt stays readable this long, so a poll that races the one that saw the result still gets it. */
const RESULT_RETENTION_MS = 60_000;

const SLOW_DOWN_STEP_SECONDS = 5;

/** Where an attempt stands. Only `pending` can change. */
export type AttemptResult =
	| { state: 'pending' }
	| { state: 'signed-in'; signIn: CompletedSignIn }
	| { state: 'expired' }
	| { state: 'denied' }
	| { state: 'failed'; reason: string };

interface Attempt {
	target: ForgeTarget;
	/** The account this sign-in links a forge to, or null for a plain sign-in. */
	linkTo: string | null;
	deviceCode: string;
	expiresAt: number;
	intervalMs: number;
	nextPollAt: number;
	result: AttemptResult;
	/** The poll in flight, so overlapping requests share one call to the forge. */
	polling: Promise<void> | null;
	discardAt: number;
}

/**
 * Device sign-ins in progress, in memory like the agent sign-in attempts: an attempt lives minutes, and a restart
 * just means starting again. Nothing polls in the background. The app asks, and each ask polls the forge at most
 * once per interval the forge set (it lengthens on `slow_down`), so an attempt nobody watches costs nothing and
 * the forge's pace is kept whatever the app's.
 */
export class DeviceSignIns {
	private readonly attempts = new Map<string, Attempt>();

	constructor(private readonly now: () => number = () => Date.now()) {}

	/** Asks the forge for a code and opens an attempt for it. */
	async start(target: ForgeTarget, linkTo: string | null): Promise<DeviceSignIn> {
		this.discardFinished();

		if (this.attempts.size >= MAX_OPEN_ATTEMPTS) {
			throw new ForgeOAuthError('Too many sign-ins are open. Wait a moment and try again.', 'busy');
		}

		const grant = await requestDeviceCode(target);
		const startedAt = this.now();
		const attemptId = randomBytes(32).toString('base64url');
		const expiresAt = startedAt + grant.expiresInSeconds * 1000;
		const intervalMs = grant.intervalSeconds * 1000;

		this.attempts.set(attemptId, {
			target,
			linkTo,
			deviceCode: grant.deviceCode,
			expiresAt,
			intervalMs,
			nextPollAt: startedAt + intervalMs,
			result: { state: 'pending' },
			polling: null,
			discardAt: expiresAt + RESULT_RETENTION_MS
		});

		return {
			attemptId,
			userCode: grant.userCode,
			verificationUri: grant.verificationUri,
			interval: grant.intervalSeconds,
			expiresAt: new Date(expiresAt).toISOString()
		};
	}

	/** The attempt's state, polling the forge first when its interval has passed. An unknown attempt has expired. */
	async check(attemptId: string): Promise<AttemptResult> {
		const attempt = this.attempts.get(attemptId);

		if (!attempt) return { state: 'expired' };

		if (attempt.result.state === 'pending') {
			attempt.polling ??= this.advance(attempt).finally(() => (attempt.polling = null));
			await attempt.polling;
		}

		return attempt.result;
	}

	private async advance(attempt: Attempt): Promise<void> {
		const now = this.now();

		if (now >= attempt.expiresAt) return this.settle(attempt, { state: 'expired' });
		if (now < attempt.nextPollAt) return;

		try {
			const poll = await pollDeviceToken(attempt.target, attempt.deviceCode, now);

			await this.apply(attempt, poll);
		} catch (error) {
			this.handleFailure(attempt, error);
		}
	}

	private async apply(attempt: Attempt, poll: Awaited<ReturnType<typeof pollDeviceToken>>): Promise<void> {
		switch (poll.kind) {
			case 'pending':
				attempt.nextPollAt = this.now() + attempt.intervalMs;

				return;
			case 'slow-down':
				attempt.intervalMs = (poll.intervalSeconds ?? attempt.intervalMs / 1000 + SLOW_DOWN_STEP_SECONDS) * 1000;
				attempt.nextPollAt = this.now() + attempt.intervalMs;

				return;
			case 'expired':
				return this.settle(attempt, { state: 'expired' });
			case 'denied':
				return this.settle(attempt, { state: 'denied' });
			case 'granted':
				return this.finish(attempt, poll.token);
		}
	}

	private async finish(attempt: Attempt, token: IssuedToken): Promise<void> {
		const outcome = await completeSignIn(attempt.target, token, attempt.linkTo);

		if (outcome.kind === 'completed') return this.settle(attempt, { state: 'signed-in', signIn: outcome.signIn });

		this.settle(attempt, {
			state: 'failed',
			reason: 'This server already has an account. Sign in with a forge linked to it.'
		});
	}

	/** An unreachable forge is retried at the next interval; anything else ends the attempt with a reason fit to show. */
	private handleFailure(attempt: Attempt, error: unknown): void {
		if (error instanceof ForgeOAuthError && error.reason === 'unreachable') {
			attempt.nextPollAt = this.now() + attempt.intervalMs;

			return;
		}

		if (error instanceof ForgeOAuthError) return this.settle(attempt, { state: 'failed', reason: error.message });

		console.error('[accounts] sign-in failed', error instanceof Error ? error.name : typeof error);
		this.settle(attempt, { state: 'failed', reason: 'Sign-in failed. Try again.' });
	}

	private settle(attempt: Attempt, result: AttemptResult): void {
		attempt.result = result;
		attempt.discardAt = this.now() + RESULT_RETENTION_MS;
	}

	private discardFinished(): void {
		const now = this.now();

		for (const [id, attempt] of this.attempts) if (attempt.discardAt < now) this.attempts.delete(id);
	}
}

export const deviceSignIns = new DeviceSignIns();
