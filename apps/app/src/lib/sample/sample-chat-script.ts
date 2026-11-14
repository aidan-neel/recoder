import { isStepRunning, type ChatCitation, type ChatTrailFile, type ChatTrailStep } from '@recoder/shared';

/** One step of a scripted reply: when it starts and ends, in ms from the start of the reply, and what it shows. */
type ScriptedStep = { start: number; end: number } & (
	| { kind: 'thought'; title: string; text: string }
	| { kind: 'search'; query: string; scope?: string; files: ChatTrailFile[] }
	| { kind: 'read'; files: ChatTrailFile[] }
	| { kind: 'run'; command: string; summary: string; failed?: true }
);

/** A scripted reply as the sample plays it: its steps on a clock, then its answer and what the answer cites. */
export interface ReplyScript {
	steps: ScriptedStep[];
	/** When the answer starts to stream, in ms from the start of the reply. */
	answerAt: number;
	answer: string;
	citations: ChatCitation[];
}

/** The share of a thought's time spent typing its text; the rest is a pause before the next step. */
const TYPING_SHARE = 0.92;

const LIMITER_FILE = 'src/rate-limit/limiter.ts';
const MIDDLEWARE_FILE = 'src/rate-limit/middleware.ts';

const LIMITER_TAKE = `const elapsed = (now - bucket.at) / 1000;

bucket.tokens = bucket.tokens + elapsed * this.options.refillPerSecond;
bucket.at = now;`;

/** A question about the rate limiter's refill, idle buckets or capacity: the one the sample answers in full. */
const REFILL_QUESTION = /refill|idle|burst|capacity|overflow|bank/i;

/** The reply to a question about the refill, played with the timing of a real reply that searches, reads and thinks. */
const REFILL_SCRIPT: ReplyScript = {
	steps: [
		{
			kind: 'search',
			start: 900,
			end: 2600,
			query: 'refillPerSecond',
			scope: 'src',
			files: [{ path: LIMITER_FILE }, { path: MIDDLEWARE_FILE }]
		},
		{
			kind: 'read',
			start: 2600,
			end: 5500,
			files: [{ path: LIMITER_FILE }, { path: MIDDLEWARE_FILE }, { path: 'docs/rate-limits.md' }]
		},
		{
			kind: 'run',
			start: 5500,
			end: 6700,
			command: 'bun test tests/rate-limit',
			summary: '9 passed, none of them idles a bucket'
		},
		{
			kind: 'thought',
			start: 6700,
			end: 8500,
			title: 'Framing the question',
			text: 'They ask why a bucket can hold more than its capacity after it sits idle. That is a question about what `take` does with the time since the last request.'
		},
		{
			kind: 'thought',
			start: 8500,
			end: 10600,
			title: 'Checking the refill math',
			text: '`take` adds elapsed seconds times the refill rate and never clamps the sum. After an hour at 1.67 tokens a second that is about 6,000 tokens against a capacity of 100.'
		},
		{
			kind: 'thought',
			start: 10600,
			end: 12400,
			title: 'Planning the answer',
			text: 'Name the line, show what it costs in requests, give the one-line fix, and say which test would hold it.'
		}
	],
	answerAt: 12800,
	answer: `A bucket grows past its capacity because \`take\` never caps the refill. It adds \`elapsed × refillPerSecond\` on every call and stores the sum as it is [limiter.ts:22-25](#cite:${LIMITER_FILE}:22-25).

After an hour idle that is about 6,000 tokens, so a tenant can send 6,000 requests before its first \`429\`. The rate comes from config [rate limit setup](#cite:${MIDDLEWARE_FILE}:6-9,${LIMITER_FILE}:2-6), and nothing after it clamps the bucket.

Cap the refill at capacity:

\`\`\`ts
bucket.tokens = Math.min(
	this.options.capacity,
	bucket.tokens + elapsed * this.options.refillPerSecond
);
\`\`\`

The review's reproduction test only covers the shared \`anonymous\` bucket. A test that idles a bucket for an hour and counts the requests that pass would hold this one.`,
	citations: [
		{ path: LIMITER_FILE, startLine: 22, endLine: 25, snippet: LIMITER_TAKE },
		{
			path: MIDDLEWARE_FILE,
			startLine: 6,
			endLine: 9,
			snippet: `const limiter = new Limiter({
	capacity: config.rateLimit.capacity,
	refillPerSecond: config.rateLimit.capacity / 60
});`
		},
		{
			path: LIMITER_FILE,
			startLine: 2,
			endLine: 6,
			snippet: `export interface BucketOptions {
	capacity: number;
	refillPerSecond: number;
	now?: () => number;
}`
		}
	]
};

/** The passages the seeded first answer cites. */
export const LOOKUP_CITATIONS: ChatCitation[] = [
	{
		path: MIDDLEWARE_FILE,
		startLine: 15,
		snippet: "const tenant = c.req.header('x-tenant-id') ?? 'anonymous';"
	},
	{
		path: LIMITER_FILE,
		startLine: 21,
		snippet: 'const bucket = this.buckets.get(key) ?? { tokens: this.options.capacity, at: now };'
	}
];

/** A short look-up that finds the tenant key: what the seeded turns show, and what a question the sample cannot answer plays. */
export const LOOKUP_SCRIPT: ReplyScript = {
	steps: [
		{ kind: 'search', start: 700, end: 1900, query: 'x-tenant-id', scope: 'src', files: [{ path: MIDDLEWARE_FILE }] },
		{ kind: 'read', start: 1900, end: 3300, files: [{ path: MIDDLEWARE_FILE }, { path: LIMITER_FILE }] },
		{
			kind: 'thought',
			start: 3300,
			end: 4900,
			title: 'Tracing the key',
			text: 'The middleware reads the tenant header and hands it to `take`; the limiter keeps one bucket per key.'
		}
	],
	answerAt: 5200,
	answer: '',
	citations: []
};

/** A reply that shows every state of the trail at rest: reasoning, a group of calls with one that failed, a lone call. */
export const TOUR_SCRIPT: ReplyScript = {
	steps: [
		{
			kind: 'thought',
			start: 0,
			end: 12000,
			title: 'Reading the question',
			text: 'The fix has to stop header-less requests from sharing one bucket. That touches the middleware key and the test that reproduces it.'
		},
		{ kind: 'search', start: 12000, end: 13400, query: 'anonymous', scope: 'src', files: [{ path: MIDDLEWARE_FILE }] },
		{
			kind: 'read',
			start: 13400,
			end: 15200,
			files: [{ path: MIDDLEWARE_FILE }, { path: LIMITER_FILE }, { path: 'tests/rate-limit/limiter.test.ts' }]
		},
		{
			kind: 'run',
			start: 15200,
			end: 21800,
			command: 'bun test tests/rate-limit',
			summary: '1 failed, 8 passed\nlimiter.test.ts: shared anonymous bucket locks out a second client',
			failed: true
		},
		{
			kind: 'run',
			start: 21800,
			end: 22400,
			command: 'git log -1 --format=%h src/rate-limit',
			summary: 'a3f9c1e'
		},
		{
			kind: 'thought',
			start: 22400,
			end: 31000,
			title: 'Choosing the key',
			text: 'Key by client address behind the proxy. `x-forwarded-for` holds the first address, so read that.'
		},
		{ kind: 'read', start: 31000, end: 32000, files: [{ path: 'src/rate-limit/client-address.ts' }] }
	],
	answerAt: 32400,
	answer: '',
	citations: []
};

/** The script that answers a question: the refill one when the question is about it, else the look-up. */
export function scriptFor(question: string): ReplyScript {
	return REFILL_QUESTION.test(question) ? REFILL_SCRIPT : LOOKUP_SCRIPT;
}

/**
 * The trail `elapsedMs` into a scripted reply, as the server would have saved it by then: steps that have not
 * begun are absent, a thought's text is as far typed as the time allows, and a read's files appear one by one.
 * `startedAt` is the reply's start, in ms since the epoch.
 */
export function trailAt(script: ReplyScript, elapsedMs: number, startedAt: number): ChatTrailStep[] {
	return script.steps.flatMap((step, index): ChatTrailStep[] => {
		if (elapsedMs < step.start) return [];

		const base = { id: `sample-step-${index}`, startedAt: new Date(startedAt + step.start).toISOString() };
		const done = elapsedMs >= step.end;
		const endedAt = done ? { endedAt: new Date(startedAt + step.end).toISOString() } : {};

		if (step.kind === 'thought') {
			const typed = (elapsedMs - step.start) / ((step.end - step.start) * TYPING_SHARE);
			const length = Math.floor(step.text.length * Math.min(1, typed));

			return [{ ...base, ...endedAt, kind: 'thought', title: step.title, text: step.text.slice(0, length) }];
		}

		const status = done ? 'done' : 'running';
		const runStatus = done && step.kind === 'run' && step.failed ? 'error' : status;

		if (step.kind === 'run')
			return [
				{
					...base,
					...endedAt,
					kind: 'run',
					status: runStatus,
					command: step.command,
					...(done ? { summary: step.summary } : {})
				}
			];

		if (step.kind === 'search')
			return [
				{
					...base,
					...endedAt,
					kind: 'search',
					status,
					query: step.query,
					scope: step.scope,
					files: done ? step.files : []
				}
			];

		return [
			{
				...base,
				...endedAt,
				kind: 'read',
				status,
				files: step.files.filter((_, at) => elapsedMs >= readTime(step, at))
			}
		];
	});
}

/** The steps with any still going closed at `now` (ms since the epoch), for a reply cut short. */
export function endedTrail(steps: ChatTrailStep[], now: number): ChatTrailStep[] {
	const endedAt = new Date(now).toISOString();

	return steps.map((step) => {
		if (!isStepRunning(step)) return step;

		return step.kind === 'thought' ? { ...step, endedAt } : { ...step, status: 'done', endedAt };
	});
}

/** When the file at `index` of a read has been opened: spread across the read, the last just before it ends. */
function readTime(step: { start: number; end: number; files: ChatTrailFile[] }, index: number): number {
	return step.start + ((index + 1) * (step.end - step.start)) / (step.files.length + 0.5);
}
