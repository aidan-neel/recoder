import type { DiscussResponse } from '@recoder/shared';

import { BUG_SUGGESTIONS, PULL_SUGGESTIONS } from '../ask/suggestions';

/** What a suggested question about a finding asks, in the order of `BUG_SUGGESTIONS`. */
type BugIntent = 'why' | 'fix' | 'doubt';

const BUG_INTENTS: BugIntent[] = ['why', 'fix', 'doubt'];

/** The pause before the first words, so a reply reads as thought about. */
const THINK_MS = 650;

/** The gap between streamed pieces. */
export const CHUNK_MS = 28;

/** Scripted answers to the suggested questions on the sample review's findings, by finding id. */
const BUG_SCRIPT: Record<string, Record<BugIntent, string>> = {
	'sample-f1': {
		why: 'Sign-up and login run before a tenant exists, so those requests carry no `x-tenant-id`. The middleware falls back to the key `anonymous` (middleware.ts:15), and the limiter keeps one bucket per key (limiter.ts:21). Every unauthenticated client now shares 100 requests a minute.\n\nOne script that sends 100 header-less requests locks everyone out of signing in for up to a minute. The reproduction test shows a second client getting `429` after the first spent the bucket.',
		fix: "Key header-less requests by client address instead of one shared name:\n\n```ts\nconst key = c.req.header('x-tenant-id') ?? `ip:${clientAddress(c)}`;\n```\n\nBehind the proxy, read the first address in `x-forwarded-for`. If anonymous traffic should never reach the limiter, answer `400` before it instead. Either way, keep the reproduction test in the suite so the shared bucket can’t come back.",
		doubt:
			'I don’t think so. I ran it: `bun test tests/rate-limit/anonymous.repro.test.ts` fails on this branch, and the second client gets `429` instead of `200`.\n\nIt would only be harmless if every route under `/api/*` needed a tenant. Sign-up and login don’t, and the docs say limits are per tenant (docs/rate-limits.md:3).'
	},
	'sample-f2': {
		why: '`take` adds `elapsed × refillPerSecond` to the bucket and never caps it (limiter.ts:24). After an hour idle that is 3,600 s at about 1.67 tokens a second: roughly 6,000 tokens. The tenant can send 6,000 requests before its first `429`.\n\nThe limit is 100 a minute. A burst sixty times that size is what the limiter exists to stop.',
		fix: 'Cap the refill at capacity:\n\n```ts\nbucket.tokens = Math.min(\n\tthis.options.capacity,\n\tbucket.tokens + elapsed * this.options.refillPerSecond\n);\n```\n\nAdd a test that idles a bucket for an hour and checks that at most `capacity` requests pass.',
		doubt:
			'No. Nothing between reading the elapsed time (limiter.ts:22) and writing the bucket (limiter.ts:24) caps it, and no caller clamps it afterwards.\n\nIt would only be intended if the bucket should bank unused capacity, and nothing in the PR or the docs says so.'
	},
	'sample-f3': {
		why: 'The PR adds `config.rateLimit.windowMs`, but the middleware still divides capacity by a hard-coded `60` (middleware.ts:8). With today’s 60-second window nothing breaks. Change the window in config and the refill rate stays per minute, so the setting silently does nothing.',
		fix: 'Derive the rate from the config:\n\n```ts\nrefillPerSecond: config.rateLimit.capacity / (config.rateLimit.windowMs / 1000)\n```\n\nThe checked patch on this decision does that, and the existing tests still pass.',
		doubt:
			'It is low risk rather than wrong: with today’s window both give the same rate. It is raised because every other limit in `config.ts` is read where it is used, and this one is not.'
	}
};

/** Scripted answers to the suggested questions about the whole pull request, in the order of `PULL_SUGGESTIONS`. */
const PULL_SCRIPT = [
	'It adds per-tenant rate limiting in front of `/api/*`: a token bucket of 100 requests a minute for each tenant, a `429` with `Retry-After` when a tenant runs out, and per-minute usage counts in Redis.\n\nHealth checks stay unlimited.',
	'Start with `src/rate-limit/limiter.ts`, the token bucket, then `middleware.ts`, which picks the bucket key. The open findings sit in those two files.',
	'Not yet. Requests without a tenant header share one bucket, so one script can lock everyone out of signing in. Fix that first; the other two findings can follow.'
];

/** What a question this script has no answer for gets. */
const UNSCRIPTED =
	'This is the sample, so its replies are scripted. Track a repository to ask about your own pull requests.';

/** The scripted reply to a question about one finding of the sample. */
export function bugReply(findingId: string, question: string): string {
	const intent = BUG_INTENTS[BUG_SUGGESTIONS.indexOf(question.trim())];

	return (intent && BUG_SCRIPT[findingId]?.[intent]) || UNSCRIPTED;
}

/** The scripted reply to a question about the sample pull request. */
export function pullReply(question: string): string {
	return PULL_SCRIPT[PULL_SUGGESTIONS.indexOf(question.trim())] ?? UNSCRIPTED;
}

/** Splits a reply into the word-sized pieces a model streams. */
export function replyPieces(text: string): string[] {
	return text.match(/\S+\s*|\s+/g) ?? [text];
}

/**
 * Streams a scripted reply locally, as the discuss endpoint streams a real
 * one. Rejects with an `AbortError` when stopped.
 */
export function streamReply(
	reply: string,
	onToken: (text: string) => void,
	signal: AbortSignal
): Promise<DiscussResponse> {
	const pieces = replyPieces(reply);

	return new Promise((resolve, reject) => {
		let at = 0;
		let timer = setTimeout(next, THINK_MS);

		function next(): void {
			onToken(pieces[at]);
			at += 1;

			if (at < pieces.length) timer = setTimeout(next, CHUNK_MS);
			else resolve({ agent: 'reviewer', model: 'sample', reply });
		}

		signal.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				reject(new DOMException('The reply was stopped.', 'AbortError'));
			},
			{ once: true }
		);
	});
}
