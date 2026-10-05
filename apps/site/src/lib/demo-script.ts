import type { ReviewToolCall } from '@recoder/shared';
import { STAGE } from '$web/review/review-progress-state';
import { taskGroupLabel } from '$web/review/review-transcript';

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
	units: 7200,
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

type Tool = { action: string; path?: string; query?: string; command?: string; at: number; ms: number };

const tools: Tool[] = [
	{ action: 'readDiff', path: 'src/rate-limit/limiter.ts', at: 0, ms: 400 },
	{ action: 'search', query: 'allow\\( in src/', at: 380, ms: 1100 },
	{ action: 'readFile', path: 'src/rate-limit/index.ts', at: 900, ms: 200 },
	{ action: 'readFile', path: 'src/time/clock.ts', at: 1250, ms: 200 }
];

const plan =
	'This turns the module-level limiter into a `RateLimiter` class with an injectable `Clock`. The risk sits in two places: callers of the old free `allow()`, and whether refill timing actually uses the new clock.\n\nI split the change into five units, one per folder.';

const summary =
	'The class refactor is sound, but two things should block the merge.\n\n`index.ts` still re-exports `allow()`, which no longer exists, so all 14 call sites break at import. And `refill()` reads `Date.now()` directly, so the injected clock does nothing in tests.\n\nThe rest is small: an unbounded buckets Map, an unvalidated capacity, and a stale usage example. Four of the five have a suggested patch ready.';

/**
 * The main thread reviews the five units itself, so their work shows inline as one work row: a
 * thought, then the tools the units ran. Offsets are from AT.units.
 */
const unitFinishes = [1400, 1800, 3000, 3400, 3800];

const UNITS_END = unitFinishes[unitFinishes.length - 1];

const unitThought = {
	end: 900,
	text: 'Five units. The callers of the old `allow()` and the refill path carry the risk, so those come first.'
};

const unitTools: Tool[] = [
	{ action: 'readFile', path: 'docs/rate-limiting.md', at: 900, ms: 300 },
	{ action: 'run', command: 'rg -n "allow\\(" src tests', at: 1000, ms: 500 },
	{ action: 'readFile', path: 'src/rate-limit/limiter.ts', at: 1500, ms: 300 },
	{ action: 'readFile', path: 'src/rate-limit/bucket.ts', at: 1900, ms: 250 },
	{ action: 'run', command: 'bun test tests/rate-limit', at: 2200, ms: 1300 },
	{ action: 'run', command: 'bunx tsc --noEmit', at: 2600, ms: 1100 }
];

/** The one spawned agent: a subagent the limiter's unit asked for, named for its question. */
const subagent = {
	id: 'subagent-1',
	name: 'Refill timing under the injected clock',
	model: 'qwen3-coder',
	/** What it's doing while running, then its closing line. */
	op: 'Running a repro with a fake Clock',
	doneOp: 'Ran a repro with a fake Clock · 1 finding',
	/** Offsets from AT.units: queued when asked for, started once the last unit finishes. */
	shows: 3400,
	starts: 3800,
	finishes: 5100,
	elapsed: '33s'
};

/** `agent` is set only on the subagent's finding, which its rail row counts. */
type Finding = { id: string; agent?: string; severity: Severity; title: string; location: string; at: number };

/** `at` is an offset from AT.units, when the unit or subagent that found it reports it. */
const findings: Finding[] = [
	{
		id: 'f1',
		severity: 'high',
		title: 'index.ts re-exports allow(), which no longer exists',
		location: 'src/rate-limit/index.ts:3',
		at: 1300
	},
	{
		id: 'f2',
		severity: 'low',
		title: 'Usage example still calls the free allow()',
		location: 'docs/rate-limiting.md:14',
		at: 1400
	},
	{
		id: 'f4',
		severity: 'low',
		title: 'capacity is never validated',
		location: 'src/rate-limit/limiter.ts:16',
		at: 2600
	},
	{
		id: 'f6',
		severity: 'medium',
		title: 'buckets Map has no eviction',
		location: 'src/rate-limit/bucket.ts:11',
		at: 3000
	},
	{
		id: 'f3',
		agent: subagent.id,
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

/** Demo ms as the seconds the app would show: the demo runs at roughly 8x real time. */
function seconds(ms: number): number {
	return Math.floor(ms * 0.0075);
}

/** The tool calls in `list` that have started by `t`, where `base` is when the list begins. */
function toolCallsAt(list: Tool[], base: number, t: number, prefix: string): ReviewToolCall[] {
	return list
		.filter((tool) => t >= base + tool.at)
		.map((tool, i) => {
			const done = t >= base + tool.at + tool.ms;

			return {
				id: `${prefix}-${i}`,
				command: `${tool.action} ${tool.path ?? tool.query ?? tool.command}`,
				input: { action: tool.action, path: tool.path, query: tool.query, command: tool.command },
				status: done ? 'done' : 'running',
				exitCode: done ? 0 : null,
				startedAt: iso(base + tool.at),
				elapsedMs: done ? tool.ms : Math.round(t - base - tool.at)
			};
		});
}

export function demoState(t: number) {
	const toolCalls = toolCallsAt(tools, AT.toolsStart, t, 'tool');
	const since = t - AT.units;
	const unitsDone = t < AT.units ? 0 : unitFinishes.filter((at) => since >= at).length;
	const agents = t < AT.units || since < subagent.shows ? [] : [agentRow(since)];
	const agentsDone = agents.filter((item) => item.status === 'done').length;

	const found = findings
		.filter((finding) => t >= AT.units + finding.at)
		.sort((a, b) => RANK[a.severity] - RANK[b.severity]);

	return {
		user: t >= AT.user,
		reasoning: t >= AT.reasonStart ? { running: t < AT.reasonEnd, text: reasoning } : null,
		toolCalls,
		toolsRunning: toolCalls.some((tool) => tool.status === 'running') || (toolCalls.length > 0 && t < AT.toolsEnd),
		/** The tool group is open while it runs, then folds away. */
		toolsOpen: t >= AT.toolsStart && t < AT.toolsEnd + 400,
		plan: stream(plan, t, AT.planStart, AT.planEnd),
		thinking: (t >= AT.toolsEnd && t < AT.planStart) || (t >= AT.finalizeEnd && t < AT.summaryStart),
		unitWork: t >= AT.units ? workAt(since, toolCallsAt(unitTools, AT.units, t, 'unit-tool')) : null,
		agents,
		agentsDone,
		agentsFinished: since >= subagent.finishes,
		reviewers: { done: unitsDone, failed: 0, total: unitFinishes.length },
		subagents: agents.length ? { done: agentsDone, failed: 0, total: agents.length } : null,
		findings: found,
		progress: progressAt(t, unitsDone, found.length),
		summary: stream(summary, t, AT.summaryStart, AT.summaryEnd),
		finished: t >= AT.result,
		stage: stageAt(t),
		elapsed: clock(t)
	};
}

/** The units' work row: "Working 9s · running 2 commands" while they run, then "Worked for 28s". */
function workAt(since: number, tools: ReviewToolCall[]) {
	const working = since < UNITS_END;

	return {
		working,
		time: `${seconds(working ? since : UNITS_END)}s`,
		doing: tools.some((tool) => tool.status === 'running') ? taskGroupLabel(tools, true) : '',
		thought: {
			text: unitThought.text,
			working: since < unitThought.end,
			time: `${seconds(Math.min(since, unitThought.end))}s`
		},
		tools
	};
}

/** A queued subagent waits for the units to finish. */
function agentRow(since: number) {
	const status: AgentStatus = since >= subagent.finishes ? 'done' : since >= subagent.starts ? 'running' : 'queued';

	return {
		...subagent,
		status,
		current: status === 'done' ? subagent.doneOp : status === 'queued' ? 'Waiting for the units to finish' : subagent.op
	};
}

/** The ReviewSteps index (`STAGE`) the Progress card shows at `t`. */
function stageAt(t: number): number {
	if (t >= AT.result) return STAGE.done;
	if (t >= AT.consolidateStart) return STAGE.consolidation;
	if (t >= AT.verifyStart) return STAGE.verify;
	if (t >= AT.units + subagent.starts) return STAGE.subagents;
	if (t >= AT.units) return STAGE.reviewing;
	if (t >= AT.toolsEnd) return STAGE.checks;
	if (t >= AT.reasonStart) return STAGE.understand;

	return STAGE.checkout;
}

/**
 * The live progress row under the transcript: the units, then the subagent, then every finding
 * verified by running code and the survivors consolidated.
 */
function progressAt(t: number, unitsDone: number, total: number): { running: boolean; label: string } | null {
	if (t < AT.units) return null;
	if (t >= AT.finalizeEnd) return { running: false, label: 'Finalized review for 18s' };
	if (t >= AT.consolidateStart) return { running: true, label: 'Consolidating findings' };

	if (t >= AT.verifyStart) {
		const verified = Math.floor(((t - AT.verifyStart) / (AT.consolidateStart - AT.verifyStart)) * total);

		return { running: true, label: `Verifying findings · ${verified}/${total}` };
	}

	if (t >= AT.units + subagent.starts) return { running: true, label: 'Waiting on subagent' };

	return { running: true, label: `Reviewing · ${unitsDone} of ${unitFinishes.length} units` };
}

/** The Progress card's timer. */
function clock(t: number): string {
	const total = seconds(Math.min(t, AT.result));

	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export const findingCounts = (items: { severity: Severity }[]) =>
	(['high', 'medium', 'low'] as const)
		.map((severity) => ({ severity, count: items.filter((item) => item.severity === severity).length }))
		.filter((item) => item.count > 0);
