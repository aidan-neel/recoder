import type { ReviewToolCall } from '@recoder/shared';
import { STAGE } from '$web/review/review-progress-state';

/**
 * The hero demo: one scripted review, replayed on a loop. Every piece of state
 * is a pure function of `t` (ms since the loop started), so reduced motion can
 * render the finished review by jumping to `DEMO_END`.
 */

type Severity = 'high' | 'medium' | 'low';

type AgentStatus = 'queued' | 'running' | 'done';

const AT = {
	user: 300,
	reasonStart: 900,
	reasonEnd: 2500,
	toolsStart: 2500,
	toolsEnd: 4300,
	planStart: 4700,
	planEnd: 6900,
	reviewers: 7200,
	verifyStart: 12300,
	consolidateStart: 13000,
	finalizeEnd: 13600,
	summaryStart: 13800,
	summaryEnd: 17600,
	result: 17900
} as const;

/** Held on the finished review, then the loop fades out and replays. */
export const DEMO_END = 18400;
export const DEMO_HOLD = 6500;

const DEMO_FADE = 450;

export const DEMO_LOOP = DEMO_END + DEMO_HOLD + DEMO_FADE;

export const request = 'Review this. Focus on the clock injection and anything that breaks existing callers.';

const reasoning =
	'Reading the diff and the code around it. The limiter moves from module state into a class, so the old free `allow()` and every caller of it matter most.';

const tools = [
	{ action: 'readDiff', path: 'src/rate-limit/limiter.ts', at: 0, ms: 400 },
	{ action: 'search', query: 'allow\\( in src/', at: 380, ms: 1100 },
	{ action: 'readFile', path: 'src/rate-limit/index.ts', at: 900, ms: 200 },
	{ action: 'readFile', path: 'src/time/clock.ts', at: 1250, ms: 200 }
];

const plan =
	'This turns the module-level limiter into a `RateLimiter` class with an injectable `Clock`. The risk sits in two places: callers of the old free `allow()`, and whether refill timing actually uses the new clock.\n\nI cut the change into five units by folder, and each gets one reviewer.';

const summary =
	'The class refactor is sound, but two things should block the merge.\n\n`index.ts` still re-exports `allow()`, which no longer exists, so all 14 call sites break at import. And `refill()` reads `Date.now()` directly, so the injected clock does nothing in tests.\n\nThe rest is small: an unbounded buckets Map, an unvalidated capacity, and a stale usage example. Four of the five have a suggested patch ready.';

type Agent = {
	id: string;
	/** A reviewer is named for its unit, a subagent for the question it was handed. */
	name: string;
	model: string;
	/** What it's doing while running, then its closing line. */
	op: string;
	doneOp: string;
	/** Offsets from AT.reviewers: when the row appears, starts and finishes. */
	shows: number;
	starts: number;
	finishes: number;
	elapsed: string;
};

/** Reviewers share the Review model; the subagent runs on the second model. */
const REVIEW_MODEL = 'gpt-5-codex';

const reviewers: Agent[] = [
	{
		id: 'unit-1',
		name: 'docs/rate-limiting.md',
		model: REVIEW_MODEL,
		op: 'Reading docs/rate-limiting.md',
		doneOp: 'Checked the usage examples · 1 finding',
		shows: 0,
		starts: 0,
		finishes: 1400,
		elapsed: '24s'
	},
	{
		id: 'unit-2',
		name: 'src/rate-limit (2 files)',
		model: REVIEW_MODEL,
		op: 'Comparing exports against 14 call sites',
		doneOp: 'Compared exports against 14 call sites · 2 findings',
		shows: 0,
		starts: 0,
		finishes: 3000,
		elapsed: '58s'
	},
	{
		id: 'unit-3',
		name: 'src/rate-limit/limiter.ts',
		model: REVIEW_MODEL,
		op: 'Reading src/rate-limit/limiter.ts:20-46',
		doneOp: 'Traced capacity through the class · 1 finding',
		shows: 0,
		starts: 0,
		finishes: 3400,
		elapsed: '1m 12s'
	},
	{
		id: 'unit-4',
		name: 'src/time/clock.ts',
		model: REVIEW_MODEL,
		op: 'Reading src/time/clock.ts',
		doneOp: 'Checked the Clock interface · no findings',
		shows: 0,
		starts: 300,
		finishes: 1800,
		elapsed: '19s'
	},
	{
		id: 'unit-5',
		name: 'tests/rate-limit (2 files)',
		model: REVIEW_MODEL,
		op: 'Running bun test tests/rate-limit',
		doneOp: 'Ran the limiter tests · no findings',
		shows: 0,
		starts: 1500,
		finishes: 3800,
		elapsed: '41s'
	}
];

/** The limiter's reviewer asks for one subagent; it runs once every reviewer has answered. */
const subagent: Agent = {
	id: 'subagent-1',
	name: 'Refill timing under the injected clock',
	model: 'qwen3-coder',
	op: 'Running a repro with a fake Clock',
	doneOp: 'Ran a repro with a fake Clock · 1 finding',
	shows: 3400,
	starts: 3900,
	finishes: 5100,
	elapsed: '33s'
};

const agents = [...reviewers, subagent];

type Finding = { id: string; agent: string; severity: Severity; title: string; location: string; at: number };

/** `at` is an offset from AT.reviewers, at or before its agent finishes. */
const findings: Finding[] = [
	{
		id: 'f1',
		agent: 'unit-2',
		severity: 'high',
		title: 'index.ts re-exports allow(), which no longer exists',
		location: 'src/rate-limit/index.ts:3',
		at: 1300
	},
	{
		id: 'f2',
		agent: 'unit-1',
		severity: 'low',
		title: 'Usage example still calls the free allow()',
		location: 'docs/rate-limiting.md:14',
		at: 1400
	},
	{
		id: 'f4',
		agent: 'unit-3',
		severity: 'low',
		title: 'capacity is never validated',
		location: 'src/rate-limit/limiter.ts:16',
		at: 2600
	},
	{
		id: 'f6',
		agent: 'unit-2',
		severity: 'medium',
		title: 'buckets Map has no eviction',
		location: 'src/rate-limit/bucket.ts:11',
		at: 3000
	},
	{
		id: 'f3',
		agent: 'subagent-1',
		severity: 'medium',
		title: 'refill() ignores the injected Clock',
		location: 'src/rate-limit/limiter.ts:23',
		at: 5000
	}
];

const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

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

	const since = t - AT.reviewers;

	const rows =
		t < AT.reviewers ? [] : agents.filter((item) => since >= item.shows).map((item) => agentRow(item, since));

	const reviewerRows = rows.filter((item) => item.id !== subagent.id);
	const subagentRow = rows.find((item) => item.id === subagent.id);

	const found = findings
		.filter((finding) => t >= AT.reviewers + finding.at)
		.sort((a, b) => RANK[a.severity] - RANK[b.severity]);

	const agentsDone = rows.filter((item) => item.status === 'done').length;
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
		agents: rows,
		agentsDone,
		agentsFinished: since >= subagent.finishes,
		reviewers: {
			done: reviewerRows.filter((item) => item.status === 'done').length,
			failed: 0,
			total: reviewers.length
		},
		subagents: subagentRow ? { done: subagentRow.status === 'done' ? 1 : 0, failed: 0, total: 1 } : null,
		findings: found,
		finalize: finalizeAt(t, found.length),
		summary: stream(summary, t, AT.summaryStart, AT.summaryEnd),
		finished,
		stage: stageAt(t),
		elapsed: clock(t)
	};
}

/** A queued subagent waits on the reviewers; a queued reviewer waits for a slot in the pool. */
function agentRow(item: Agent, since: number) {
	const status: AgentStatus = since >= item.finishes ? 'done' : since >= item.starts ? 'running' : 'queued';
	const waiting = item.id === subagent.id ? 'Waiting for reviewers to finish' : 'Waiting for a free slot';

	return { ...item, status, current: status === 'done' ? item.doneOp : status === 'queued' ? waiting : item.op };
}

/** The ReviewSteps index (`STAGE`) the Progress card shows at `t`. */
function stageAt(t: number): number {
	if (t >= AT.result) return STAGE.done;
	if (t >= AT.consolidateStart) return STAGE.consolidation;
	if (t >= AT.verifyStart) return STAGE.verify;
	if (t >= AT.reviewers + subagent.starts) return STAGE.subagents;
	if (t >= AT.reviewers) return STAGE.reviewing;
	if (t >= AT.toolsEnd) return STAGE.checks;
	if (t >= AT.reasonStart) return STAGE.understand;

	return STAGE.checkout;
}

/** Every finding is verified by running code, then the survivors are consolidated. */
function finalizeAt(t: number, total: number): { running: boolean; label: string } | null {
	if (t < AT.verifyStart) return null;
	if (t >= AT.finalizeEnd) return { running: false, label: 'Finalized review for 18s' };
	if (t >= AT.consolidateStart) return { running: true, label: 'Consolidating findings' };

	const verified = Math.floor(((t - AT.verifyStart) / (AT.consolidateStart - AT.verifyStart)) * total);

	return { running: true, label: `Verifying findings · ${verified}/${total}` };
}

/** The Progress card's timer: the demo runs at roughly 8x real time. */
function clock(t: number): string {
	const seconds = Math.floor(Math.min(t, AT.result) * 0.0075);

	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export const findingCounts = (items: { severity: Severity }[]) =>
	(['high', 'medium', 'low'] as const)
		.map((severity) => ({ severity, count: items.filter((item) => item.severity === severity).length }))
		.filter((item) => item.count > 0);
