import type { DiscussResponse } from '@recoder/shared';

import { suggestionsFor, type AskItem, type SuggestionIntent } from './item';

/** The model name under a sample reply. */
const SAMPLE_MODEL = 'sample';

/** The pause before the first words, so the reply reads as thought about. */
const THINK_MS = 650;

/** The gap between streamed chunks. */
const CHUNK_MS = 28;

/** Scripted answers to the suggestions on the sample review's decisions. */
const SCRIPT: Record<string, Partial<Record<SuggestionIntent, string>>> = {
	'decision:sample-f1': {
		why: 'Sign-up and login run before a tenant exists, so those requests carry no `x-tenant-id`. The middleware falls back to the key `anonymous` (middleware.ts:15), and the limiter keeps one bucket per key (limiter.ts:21). Every unauthenticated client now shares 100 requests a minute.\n\nOne script that sends 100 header-less requests locks everyone out of signing in for up to a minute. The reproduction test shows a second client getting `429` after the first spent the bucket.',
		fix: "Key header-less requests by client address instead of one shared name:\n\n```ts\nconst key = c.req.header('x-tenant-id') ?? `ip:${clientAddress(c)}`;\n```\n\nBehind the proxy, read the first address in `x-forwarded-for`. If anonymous traffic should never reach the limiter, answer `400` before it instead. Either way, keep the reproduction test in the suite so the shared bucket can’t come back.",
		doubt:
			'I don’t think so. I ran it: `bun test tests/rate-limit/anonymous.repro.test.ts` fails on this branch, and the second client gets `429` instead of `200`.\n\nIt would only be harmless if every route under `/api/*` needed a tenant. Sign-up and login don’t, and the docs say limits are per tenant (docs/rate-limits.md:3).'
	},
	'decision:sample-f2': {
		why: '`take` adds `elapsed × refillPerSecond` to the bucket and never caps it (limiter.ts:24). After an hour idle that is 3,600 s at about 1.67 tokens a second: roughly 6,000 tokens. The tenant can send 6,000 requests before its first `429`.\n\nThe limit is 100 a minute. A burst sixty times that size is what the limiter exists to stop.',
		fix: 'Cap the refill at capacity:\n\n```ts\nbucket.tokens = Math.min(\n\tthis.options.capacity,\n\tbucket.tokens + elapsed * this.options.refillPerSecond\n);\n```\n\nThat is the checked patch on this decision. `bun run check` and the rate-limit tests pass with it applied.',
		doubt:
			'No. The idle test fails on this branch: after a simulated hour it expected at most 100 requests to pass and got 6,000.\n\nIt would only be intended if the bucket should bank unused capacity, and nothing in the PR or the docs says so.'
	},
	'decision:sample-f3': {
		why: 'The PR adds `config.rateLimit.windowMs`, but the middleware still divides capacity by a hard-coded `60` (middleware.ts:8). With today’s 60-second window nothing breaks. Change the window in config and the refill rate stays per minute, so the setting silently does nothing.',
		fix: 'Derive the rate from the config:\n\n```ts\nrefillPerSecond: config.rateLimit.capacity / (config.rateLimit.windowMs / 1000)\n```\n\nThe checked patch on this decision does that, and the existing tests still pass.',
		doubt:
			'It is low risk rather than wrong: with today’s window both give the same rate. It is raised because every other limit in `config.ts` is read where it is used, and this one is not.'
	},
	'decision:question:Q1': {
		open: 'No reviewer could run it: the sandbox had no Redis server. Reading the code, `record` sends `INCR` and `EXPIRE` as two commands (store.ts:14-15), not in `MULTI` or as one `SET … EX`. If the process dies between them, the usage key never expires.',
		check:
			'Run it against a local Redis. Call `record` for a fresh tenant, stop the process before `EXPIRE` runs, then check the key:\n\n```sh\nredis-cli TTL usage:t1:$(date +%Y%m%d%H%M)\n```\n\n`-1` means the key has no expiry. Or skip the experiment and send both commands in one `MULTI`.',
		impact:
			'That minute’s usage key would never expire. Counts are per minute, so a stray key wastes a little memory and blocks no one. Worth fixing, not urgent.'
	}
};

/** An answer built from what the reviewer recorded, for receipts and free-form questions. */
function recorded(item: AskItem, intent: SuggestionIntent | null): string {
	if (item.kind === 'receipt') {
		const { receipt } = item;

		const run = receipt.evidence?.command
			? `\n\nI ran \`${receipt.evidence.command}\`:\n\n\`\`\`\n${receipt.evidence.observed ?? 'passed'}\n\`\`\``
			: '';

		const source = receipt.contract[0] ? `\n\n${receipt.contract[0].location}: ${receipt.contract[0].note}` : '';

		if (intent === 'how') return `${receipt.reason}${run}${source}`;

		if (intent === 'test') {
			return receipt.evidence?.command
				? `Yes: \`${receipt.evidence.command}\` passes on this branch and keeps it true.`
				: `No test runs it. The answer comes from reading the code.${source}\n\nA test would keep it true when this code changes.`;
		}
	}

	const note = item.kind === 'receipt' ? item.receipt.reason : item.decision.body;

	return `This is the sample review, so its replies are scripted. Here is what the reviewer recorded:\n\n> ${note}\n\nTrack a repository to ask about your own pull requests.`;
}

/** The scripted reply to a question about a sample item. */
function sampleAnswer(item: AskItem, question: string): string {
	const intent = suggestionsFor(item).find((suggestion) => suggestion.text === question.trim())?.intent ?? null;

	return (intent && SCRIPT[item.key]?.[intent]) || recorded(item, intent);
}

/** Splits a reply into the word-sized pieces a model streams. */
function chunks(text: string): string[] {
	return text.match(/\S+\s*|\s+/g) ?? [text];
}

/**
 * Streams the scripted reply locally, as `chatApi.discuss` would stream a real
 * one, so the sample works with no server. Rejects with an `AbortError` when
 * stopped.
 */
export function sampleDiscuss(
	item: AskItem,
	question: string,
	onToken: (text: string) => void,
	signal: AbortSignal
): Promise<DiscussResponse> {
	const reply = sampleAnswer(item, question);
	const pieces = chunks(reply);

	return new Promise((resolve, reject) => {
		let at = 0;
		let timer = setTimeout(next, THINK_MS);

		function next(): void {
			const take = 1 + (at % 3);

			onToken(pieces.slice(at, at + take).join(''));
			at += take;

			if (at < pieces.length) timer = setTimeout(next, CHUNK_MS);
			else resolve({ agent: 'reviewer', model: SAMPLE_MODEL, reply });
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
