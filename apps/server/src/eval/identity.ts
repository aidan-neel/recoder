import { createHash } from 'node:crypto';
import type { ModelRuntimeProfile } from '@recoder/shared';

/** The value of every identity field that could not be learned. */
export const UNKNOWN = 'unknown';

type Unknown = typeof UNKNOWN;

/** The caches the server keeps across reviews, each recorded with the version of its format. */
export const SERVER_CACHES = ['intent', 'rule-ledger', 'baseline-cache', 'review-checkpoint'] as const;

export type ServerCache = (typeof SERVER_CACHES)[number];

/** One review stage's model as the server ran it. */
export interface StageModel {
	model: string;
	provider: string;
	/** The reasoning effort, or `default` when the model's own default applies. */
	effort: string;
	/** The model entry's sampling overrides; `default` when it sets none and the built-in profile applies. */
	sampling: ModelRuntimeProfile | 'default';
	contextSize: number | Unknown;
	/** Local inference only; no provider reports these yet. */
	weightRevision: string;
	quantization: string;
}

/** One labeled PR at one head, with the base commit it was cut from. */
export interface TaskIdentity {
	/** `<prId>@<headSha>`: the head revision is part of the id. */
	taskId: string;
	base: string;
}

/**
 * Everything that decides a benchmark result, recorded so two reports can be
 * told apart field by field. `hash` covers the experiment fields: dataset,
 * code, models, judge, flags, limits, caches and tools. The task set is
 * compared on its own, because shards of one experiment split it, and `host`
 * and `execution` are recorded and shown but never refuse a comparison, so
 * one experiment run on two machines keeps one hash. No field holds a key.
 */
export interface RunIdentity {
	version: 1;
	hash: string;
	dataset: {
		name: string;
		/** Hash of every file in `labels/`, by name and content. */
		labels: string;
		/**
		 * Hash of the human decisions in `adjudications.json`. Unresolved entries
		 * are left out: the benchmark queues them itself and they classify a
		 * finding exactly as no entry does.
		 */
		adjudications: string;
		/** Each codebase's forge repo: its HEAD and a hash of the PR metadata the server reads. */
		forges: Record<string, { head: string; metadata: string }>;
	};
	code: {
		/** Hash of the harness tree manifest this report was written from. */
		harness: string;
		/** Hash of the server's own tree, which ran the reviewers. */
		server: string;
	};
	/** Verifiers run on the specialist model; there is no separate verifier setting. */
	models: { orchestrator: StageModel; specialist: StageModel; seed: string };
	judge: { model: string; provider: string; effort: string; version: number; seed: string };
	/** Environment switches as the server sees them, `unset` when absent. */
	flags: Record<string, string> | Unknown;
	limits: {
		/** The reviewer settings the server reports. */
		settings: Record<string, number | boolean>;
		/** The review policy's budgets and deadlines. */
		policy: Record<string, number> | Unknown;
	};
	/** Each cache namespace with the version of its format: the server's, and the harness's `benchmark-judge`. */
	caches: Record<string, string>;
	tools: { bun: string; node: string; opencode: string };
	tasks: TaskIdentity[];
	host: {
		name: string;
		os: string;
		arch: string;
		cpus: number | Unknown;
		sandbox: Record<string, number> | Unknown;
		serverCommit: string;
	};
	execution: {
		/** What was asked for: full, replay, reverify or auto. */
		mode: string;
		/** What it ran as once `--mode auto` decided: full, replay, reverify or rescore. */
		ran: string;
		concurrency: number;
		timeoutMs: number;
		runsPerPr: number;
		baselineCache: boolean;
	};
}

/** Where one run's result came from, by cache. Fields the server does not report are `unknown`. */
export interface RunCache {
	/** The review itself: run now, or reused from an earlier report or a kept checkpoint. */
	review: 'fresh' | 'resume' | 'replay' | 'reverify' | 'rescore';
	intent: Unknown;
	ruleLedger: Unknown;
	judge: Unknown;
}

/** A run's cache provenance, by how its review was obtained. */
export function runCache(review: RunCache['review']): RunCache {
	return { review, intent: UNKNOWN, ruleLedger: UNKNOWN, judge: UNKNOWN };
}

const EXPERIMENT = ['dataset', 'code', 'models', 'judge', 'flags', 'limits', 'caches', 'tools'] as const;

/** Sections that describe where and how a report ran; a difference is shown, never refused. */
const INFORMATIONAL = ['host', 'execution'];

/** Field names `--allow-diff` takes: a section or a field under one, or `identity` for a report that records none. */
const DECLARABLE = ['identity', 'tasks', ...EXPERIMENT];

/**
 * Which fields may differ depends on what an operation takes from a report.
 * The adjudications never refuse: every report applies the current ones again
 * to every run, and they decide no defect count. A replay or rescore keeps the
 * reviewers' output and recomputes the rest: the code, the policy and the
 * cache formats are what it measures, and the judge and the labels score it
 * again. Shards of one experiment cover different tasks.
 */
const EXEMPT = {
	resume: ['dataset.adjudications'],
	replay: ['dataset.adjudications', 'dataset.labels', 'judge', 'code', 'limits.policy', 'caches'],
	compare: ['dataset.adjudications'],
	merge: ['dataset.adjudications', 'tasks']
} satisfies Record<string, string[]>;

export type Operation = keyof typeof EXEMPT;

/** A field two identities disagree on, with each side's value as text. */
export interface FieldDiff {
	field: string;
	a: string;
	b: string;
}

/** A report's identity, under the name it is reported by. */
export interface Named {
	name: string;
	identity?: RunIdentity;
}

/** How two reports' identities relate, for one operation. */
export interface Compatibility {
	/** Reports that record no identity, so nothing can be claimed about them. */
	unrecorded: string[];
	refused: FieldDiff[];
	/** Differences named with `--allow-diff`. */
	declared: FieldDiff[];
	/** Differences the operation expects. */
	exempt: FieldDiff[];
	informational: FieldDiff[];
	compatible: boolean;
}

export function taskIdOf(prId: string, headSha: string): string {
	return `${prId}@${headSha}`;
}

export function runIdOf(taskId: string, index: number): string {
	return `${taskId}#${index}`;
}

/** The PR a task id names. */
function prOfTask(taskId: string): string {
	return taskId.slice(0, taskId.lastIndexOf('@'));
}

/** JSON with object keys sorted at every level, so equal values always hash alike. */
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;

	if (value && typeof value === 'object') {
		const entries = Object.entries(value).filter(([, child]) => child !== undefined);

		return `{${entries
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
			.join(',')}}`;
	}

	return JSON.stringify(value) ?? 'null';
}

/** SHA-256 of a value's canonical JSON, in hex. */
export function contentHash(value: unknown): string {
	return createHash('sha256').update(canonical(value)).digest('hex');
}

/** The identity with its hash over the experiment fields. */
export function withHash(fields: Omit<RunIdentity, 'version' | 'hash'>): RunIdentity {
	const experiment = Object.fromEntries(EXPERIMENT.map((key) => [key, fields[key]]));

	return { version: 1, hash: contentHash(experiment), ...fields };
}

/** Every leaf of the identity by dotted path, tasks keyed by task id, each value as text. */
function leaves(identity: RunIdentity): Map<string, string> {
	const { version: _version, hash: _hash, tasks, ...rest } = identity;
	const out = new Map<string, string>();

	const walk = (value: unknown, path: string) => {
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);

			return;
		}

		out.set(path.slice(1), typeof value === 'string' ? value : JSON.stringify(value));
	};

	walk({ ...rest, tasks: Object.fromEntries(tasks.map((task) => [task.taskId, task.base])) }, '');

	return out;
}

/** Every field the two identities disagree on, sorted by field; empty for equal identities. */
export function compareIdentity(a: RunIdentity, b: RunIdentity): FieldDiff[] {
	const left = leaves(a);
	const right = leaves(b);
	const fields = [...new Set([...left.keys(), ...right.keys()])].sort();

	return fields
		.filter((field) => left.get(field) !== right.get(field))
		.map((field) => ({ field, a: left.get(field) ?? '(absent)', b: right.get(field) ?? '(absent)' }));
}

function under(field: string, prefixes: readonly string[]): boolean {
	return prefixes.some((prefix) => field === prefix || field.startsWith(`${prefix}.`));
}

/** The fields of an `--allow-diff a,b` value, and why it cannot be used when one names no identity field. */
export function allowDiffFields(value: string | undefined): { fields: string[]; error: string | null } {
	const fields = (value ?? '').split(',').flatMap((field) => field.trim() || []);
	const unknown = fields.filter((field) => !DECLARABLE.includes(field.split('.')[0]!));

	return {
		fields,
		error: unknown.length
			? `--allow-diff does not know ${unknown.join(', ')}; name a field under ${DECLARABLE.join(', ')}.`
			: null
	};
}

/**
 * Sorts the differences between two reports by what `operation` makes of them.
 * A report without an identity refuses every claim unless `identity` is declared.
 */
export function checkCompatibility(a: Named, b: Named, operation: Operation, allow: readonly string[]): Compatibility {
	const unrecorded = [a, b].filter((report) => !report.identity).map((report) => report.name);
	const diffs = a.identity && b.identity ? compareIdentity(a.identity, b.identity) : [];
	const informational = diffs.filter((diff) => under(diff.field, INFORMATIONAL));
	const checked = diffs.filter((diff) => !under(diff.field, INFORMATIONAL));
	const exempt = checked.filter((diff) => under(diff.field, EXEMPT[operation]));
	const rest = checked.filter((diff) => !under(diff.field, EXEMPT[operation]));
	const declared = rest.filter((diff) => under(diff.field, allow));
	const refused = rest.filter((diff) => !under(diff.field, allow));

	return {
		unrecorded,
		refused,
		declared,
		exempt,
		informational,
		compatible: !refused.length && (!unrecorded.length || allow.includes('identity'))
	};
}

const diffLine = (diff: FieldDiff) => `  ${diff.field}: ${diff.a} → ${diff.b}`;

/** The comparison as console lines: what refuses it, what was declared, what is only recorded. */
export function compatibilityLines(result: Compatibility): string[] {
	const section = (title: string, diffs: FieldDiff[]) => (diffs.length ? [title, ...diffs.map(diffLine)] : []);

	return [
		...(result.unrecorded.length
			? [`Identity not recorded in ${result.unrecorded.join(' and ')}; no equivalence can be claimed.`]
			: []),
		...section('Incompatible:', result.refused),
		...section('Declared differences:', result.declared),
		...section('Expected differences:', result.exempt),
		...section('Recorded, not checked:', result.informational)
	];
}

/** A report as a merge reads it. */
export interface MergeInput extends Named {
	runIds?: string[];
}

/** Run ids that appear more than once across the reports. */
function duplicateRuns(reports: readonly MergeInput[]): string[] {
	const seen = new Set<string>();
	const repeated = new Set<string>();

	for (const id of reports.flatMap((report) => report.runIds ?? [])) {
		if (seen.has(id)) repeated.add(id);
		seen.add(id);
	}

	return [...repeated].sort();
}

/** PRs the reports name at more than one head. */
function splitHeads(reports: readonly MergeInput[]): string[] {
	const tasks = new Map<string, Set<string>>();

	for (const { taskId } of reports.flatMap((report) => report.identity?.tasks ?? [])) {
		const pr = prOfTask(taskId);

		tasks.set(pr, (tasks.get(pr) ?? new Set()).add(taskId));
	}

	return [...tasks.values()].filter((ids) => ids.size > 1).map((ids) => [...ids].sort().join(' vs '));
}

/**
 * Why the reports cannot be merged into one: a missing identity, an experiment
 * field that differs, a PR at two heads, or a run counted twice, which would
 * sum one run's defects as new ones. Empty when they merge.
 */
export function mergeProblems(reports: readonly MergeInput[]): string[] {
	const unrecorded = reports.filter((report) => !report.identity);

	if (unrecorded.length) return unrecorded.map((report) => `identity not recorded in ${report.name}`);

	const [first, ...rest] = reports;
	const duplicates = duplicateRuns(reports);

	return [
		...rest.flatMap((report) =>
			checkCompatibility(first!, report, 'merge', []).refused.map(
				(diff) => `${report.name} differs from ${first!.name} in ${diff.field}: ${diff.a} → ${diff.b}`
			)
		),
		...splitHeads(reports).map((ids) => `one PR at two heads: ${ids}`),
		...(duplicates.length
			? [
					`run ids listed more than once (${duplicates.length}): ${duplicates.slice(0, 3).join(', ')}${duplicates.length > 3 ? ', …' : ''}; a run counted twice would sum its defects as new ones`
				]
			: [])
	];
}
