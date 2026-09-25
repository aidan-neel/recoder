import type { ReviewToolCall } from '@recoder/shared';

/**
 * The hero demo: one scripted review, replayed on a loop. Every piece of state
 * is a pure function of `t` (ms since the loop started), so reduced motion can
 * render the finished review by jumping to `DEMO_END`.
 */

export type Severity = 'high' | 'medium' | 'low' | 'info';
export type SpecialistStatus = 'queued' | 'running' | 'done';

export const AT = {
	user: 300,
	reasonStart: 900,
	reasonEnd: 2500,
	toolsStart: 2500,
	toolsEnd: 4300,
	planStart: 4700,
	planEnd: 6900,
	specialists: 7200,
	finalizeStart: 12300,
	finalizeEnd: 13600,
	summaryStart: 13800,
	summaryEnd: 17600,
	result: 17900
} as const;

/** Held on the finished review, then the loop fades out and replays. */
export const DEMO_END = 18400;
export const DEMO_HOLD = 6500;
export const DEMO_FADE = 450;
export const DEMO_LOOP = DEMO_END + DEMO_HOLD + DEMO_FADE;

export const request = 'Review this. Focus on the clock injection and anything that breaks existing callers.';

export const reasoning =
	'Reading the diff to scope specialists. The limiter moves from module state into a class, so the old free `allow()` and every caller of it matter most.';

const tools = [
	{ action: 'readDiff', path: 'src/rate-limit/limiter.ts', at: 0, ms: 400 },
	{ action: 'search', query: 'allow\\( in src/', at: 380, ms: 1100 },
	{ action: 'readFile', path: 'src/rate-limit/index.ts', at: 900, ms: 200 },
	{ action: 'readFile', path: 'src/time/clock.ts', at: 1250, ms: 200 }
];

export const plan =
	'This turns the module-level limiter into a `RateLimiter` class with an injectable `Clock`. The risk sits in two places: callers of the old free `allow()`, and whether refill timing actually uses the new clock.\n\nI’m sending five specialists. Correctness and repository consistency always run; performance, docs and security were picked for this diff.';

export const summary =
	'The class refactor is sound, but two things should block the merge.\n\n`index.ts` still re-exports `allow()`, which no longer exists, so all 14 call sites break at import. And `refill()` reads `Date.now()` directly, so the injected clock does nothing in tests.\n\nThe rest is small: an unbounded buckets Map, an unvalidated capacity, and a stale doc comment. Four of the six have a suggested patch ready.';

type Specialist = {
	id: string;
	name: string;
	model: string;
	/** What it's doing while running, then its closing line. */
	op: string;
	doneOp: string;
	/** Offset from AT.specialists. */
	starts: number;
	finishes: number;
	elapsed: string;
};

const specialists: Specialist[] = [
	{ id: 'correctness', name: 'Correctness', model: 'gpt-5-codex', op: 'Reading src/rate-limit/limiter.ts:20-46', doneOp: 'Traced refill() and capacity through the class · 3 findings', starts: 0, finishes: 3600, elapsed: '1m 12s' },
	{ id: 'patterns', name: 'Repository consistency', model: 'gpt-5-codex', op: 'Comparing exports against 14 call sites', doneOp: 'Compared exports against 14 call sites · 1 finding', starts: 0, finishes: 1300, elapsed: '38s' },
	{ id: 'perf', name: 'Performance', model: 'qwen3-coder', op: 'Searching src/ for Map eviction patterns', doneOp: 'Checked the buckets Map lifecycle · 1 finding', starts: 300, finishes: 4300, elapsed: '51s' },
	{ id: 'docs', name: 'Documentation', model: 'qwen3-coder', op: 'Checking doc comments in src/rate-limit', doneOp: 'Checked doc comments in src/rate-limit · 1 finding', starts: 300, finishes: 2000, elapsed: '22s' },
	{ id: 'security', name: 'Security', model: 'gpt-5-codex', op: 'Waiting for a free slot', doneOp: 'Checked key handling and limits · no findings', starts: 1400, finishes: 4800, elapsed: '44s' }
];

type Finding = { id: string; agent: string; severity: Severity; title: string; location: string; at: number };

/** `at` is an offset from AT.specialists, at or before its specialist finishes. */
const findings: Finding[] = [
	{ id: 'f1', agent: 'patterns', severity: 'high', title: 'index.ts re-exports allow(), which no longer exists', location: 'src/rate-limit/index.ts:3', at: 1300 },
	{ id: 'f2', agent: 'docs', severity: 'low', title: 'Doc comment still describes a free function', location: 'src/rate-limit/limiter.ts:19', at: 2000 },
	{ id: 'f3', agent: 'correctness', severity: 'medium', title: 'refill() ignores the injected Clock', location: 'src/rate-limit/limiter.ts:23', at: 2700 },
	{ id: 'f4', agent: 'correctness', severity: 'low', title: 'capacity is never validated', location: 'src/rate-limit/limiter.ts:16', at: 3300 },
	{ id: 'f5', agent: 'correctness', severity: 'info', title: 'Confirm refill timing moves onto Clock', location: 'src/rate-limit/limiter.ts:1', at: 3600 },
	{ id: 'f6', agent: 'perf', severity: 'medium', title: 'buckets Map has no eviction', location: 'src/rate-limit/limiter.ts:11', at: 4300 }
];

const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };

/** Streams `text` word by word between `start` and `end`. */
function stream(text: string, t: number, start: number, end: number): { text: string; streaming: boolean } | null {
	if (t < start) return null;
	if (t >= end) return { text, streaming: false };
	const words = text.split(/(?<=\s)/);
	const shown = Math.max(1, Math.ceil(((t - start) / (end - start)) * words.length));
	return { text: words.slice(0, shown).join(''), streaming: true };
}

function iso(ms: number): string {
	return new Date(Date.UTC(2026, 8, 22, 19, 30) + ms).toISOString();
}

export function demoState(t: number) {
	const toolCalls: ReviewToolCall[] = tools
		.filter((tool) => t >= AT.toolsStart + tool.at)
		.map((tool, i) => {
			const done = t >= AT.toolsStart + tool.at + tool.ms;
			return {
				id: `tool-${i}`,
				command: `${tool.action} ${tool.path ?? tool.query}`,
				input: { action: tool.action, path: tool.path, query: tool.query },
				status: done ? 'done' : 'running',
				exitCode: done ? 0 : null,
				startedAt: iso(AT.toolsStart + tool.at),
				elapsedMs: done ? tool.ms : Math.round(t - AT.toolsStart - tool.at)
			};
		});

	const sinceSpecialists = t - AT.specialists;
	const specialistRows = t < AT.specialists ? [] : specialists.map((item) => {
		const status: SpecialistStatus = sinceSpecialists >= item.finishes ? 'done' : sinceSpecialists >= item.starts ? 'running' : 'queued';
		return { ...item, status, current: status === 'done' ? item.doneOp : status === 'queued' ? 'Waiting for a free slot' : item.op };
	});
	const found = findings.filter((finding) => t >= AT.specialists + finding.at).sort((a, b) => RANK[a.severity] - RANK[b.severity]);
	const specialistsDone = specialistRows.filter((item) => item.status === 'done').length;
	const finished = t >= AT.result;

	return {
		user: t >= AT.user,
		reasoning: t >= AT.reasonStart ? { running: t < AT.reasonEnd, text: reasoning } : null,
		toolCalls,
		toolsRunning: toolCalls.some((tool) => tool.status === 'running') || (toolCalls.length > 0 && t < AT.toolsEnd),
		/** The tool group is open while it runs, then folds away. */
		toolsOpen: t >= AT.toolsStart && t < AT.toolsEnd + 400,
		plan: stream(plan, t, AT.planStart, AT.planEnd),
		thinking: (t >= AT.toolsEnd && t < AT.planStart) || (t >= AT.finalizeEnd && t < AT.summaryStart),
		specialists: specialistRows,
		specialistsDone,
		specialistsFinished: specialistRows.length > 0 && specialistsDone === specialistRows.length,
		findings: found,
		finalize: t >= AT.finalizeStart ? { running: t < AT.finalizeEnd } : null,
		summary: stream(summary, t, AT.summaryStart, AT.summaryEnd),
		finished,
		/** ReviewSteps index: prepare, plan, specialists, consolidate. */
		step: finished ? 6 : t >= AT.finalizeStart ? 5 : t >= AT.specialists ? 3 : t >= AT.reasonStart ? 1 : 0,
		elapsed: clock(t)
	};
}

export type DemoState = ReturnType<typeof demoState>;

/** The Progress card's timer: the demo runs at roughly 8x real time. */
function clock(t: number): string {
	const seconds = Math.floor(Math.min(t, AT.result) * 0.0075);
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export const findingCounts = (items: { severity: Severity }[]) =>
	(['high', 'medium', 'low', 'info'] as const)
		.map((severity) => ({ severity, count: items.filter((item) => item.severity === severity).length }))
		.filter((item) => item.count > 0);
