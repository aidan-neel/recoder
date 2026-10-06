import { createHash } from 'node:crypto';
import type { ModelRuntimeProfile } from '@recoder/shared';

/** The value of every identity field that could not be learned. */
export const UNKNOWN = 'unknown';

type Unknown = typeof UNKNOWN;

/** A run's identity or judge stamp when the report it came from recorded none. */
export const NOT_RECORDED = 'not recorded';

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
	/** Max tokens per request, `default` when the entry sets none, `unknown` when the server could not name the entry. */
	contextSize: number | string;
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
	/**
	 * `source:<hash>` of the server and shared sources, their package
	 * manifests and the lockfile, by content and never by git state: any
	 * change to server or shared code changes it.
	 */
	code: {
		/** The checkout the harness wrote this report from. */
		harness: string;
		/** The server's checkout, which ran the reviewers. */
		server: string;
	};
	/** Verifiers run on the specialist model; there is no separate verifier setting. Reviewer calls send no seed. */
	models: { orchestrator: StageModel; specialist: StageModel };
	judge: { model: string; provider: string; effort: string; version: number; seed: number };
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
		/** Local inference only and reported by no provider yet, so recorded and never compared. */
		inference: { weightRevision: string; quantization: string };
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
	/** Why a field is `unknown`, by field: a server without the identity route, a tree that could not be read. */
	unavailable: Record<string, string>;
	/**
	 * How many of the report's runs were reviewed under each identity hash,
	 * `not recorded` for runs reused from a report that stamped none. Set when
	 * the report is written; a run reused under another identity keeps its own.
	 */
	runs?: Record<string, number>;
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
const INFORMATIONAL = ['host', 'execution', 'unavailable'];

/**
 * Field names `--allow-diff` takes: a section or a field under one, `identity`
 * for a report that records none, or `runs` for a report whose runs were
 * reviewed under other identities.
 */
const DECLARABLE = ['identity', 'runs', 'tasks', ...EXPERIMENT];

/** Operations that claim two reports' results are alike, so every run in them must have been reviewed under its report's identity. */
const RUN_CHECKED: readonly Operation[] = ['compare', 'merge'];

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
	/**
	 * Checked fields `unknown` on either side, equal or not, and runs reviewed
	 * under another identity than their report's: nothing says the two agree on them.
	 */
	unverifiable: FieldDiff[];
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
	const { version: _version, hash: _hash, runs: _runs, tasks, ...rest } = identity;
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

/** True when some run of the report was reviewed under another identity, or by a report that stamped none. */
function mixedRuns(identity: RunIdentity): boolean {
	return !identity.runs || Object.keys(identity.runs).some((hash) => hash !== identity.hash);
}

/** "2 under 1a2b3c4d5e6f, 1 not recorded": the report's runs by the identity they were reviewed under. */
export function runsText(identity: RunIdentity): string {
	if (!identity.runs) return 'runs not stamped';

	return (
		Object.entries(identity.runs)
			.map(([hash, count]) => `${count} ${hash === NOT_RECORDED ? NOT_RECORDED : `under ${hash.slice(0, 12)}`}`)
			.join(', ') || 'no runs'
	);
}

/** The `runs` field when either report holds runs reviewed under another identity than its own. */
function runPairs(a: RunIdentity, b: RunIdentity): FieldDiff[] {
	return mixedRuns(a) || mixedRuns(b) ? [{ field: 'runs', a: runsText(a), b: runsText(b) }] : [];
}

/** Every field either identity has, with both sides' values, sorted by field. */
function fieldPairs(a: RunIdentity, b: RunIdentity): FieldDiff[] {
	const left = leaves(a);
	const right = leaves(b);

	return [...new Set([...left.keys(), ...right.keys()])]
		.sort()
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
 * A checked field `unknown` on either side refuses too, even when both sides
 * are `unknown`: two reports that could not learn a value did not agree on it.
 * A compare or merge also refuses a report holding runs reviewed under
 * another identity, which its own identity does not describe.
 */
export function checkCompatibility(a: Named, b: Named, operation: Operation, allow: readonly string[]): Compatibility {
	const unrecorded = [a, b].filter((report) => !report.identity).map((report) => report.name);
	const pairs = a.identity && b.identity ? fieldPairs(a.identity, b.identity) : [];
	const runs = a.identity && b.identity && RUN_CHECKED.includes(operation) ? runPairs(a.identity, b.identity) : [];
	const unknown = (pair: FieldDiff) => pair.a === UNKNOWN || pair.b === UNKNOWN;
	const differs = (pair: FieldDiff) => pair.a !== pair.b;
	const informational = pairs.filter((pair) => under(pair.field, INFORMATIONAL) && differs(pair));
	const checked = pairs.filter((pair) => !under(pair.field, INFORMATIONAL));
	const exempt = checked.filter((pair) => under(pair.field, EXEMPT[operation]) && differs(pair));
	const rest = checked.filter((pair) => !under(pair.field, EXEMPT[operation]) && (differs(pair) || unknown(pair)));
	const declared = [...runs, ...rest].filter((pair) => under(pair.field, allow));
	const undeclared = rest.filter((pair) => !under(pair.field, allow));
	const unverifiable = [...runs.filter((pair) => !under(pair.field, allow)), ...undeclared.filter(unknown)];
	const refused = undeclared.filter((pair) => !unknown(pair));

	return {
		unrecorded,
		refused,
		unverifiable,
		declared,
		exempt,
		informational,
		compatible: !refused.length && !unverifiable.length && (!unrecorded.length || allow.includes('identity'))
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
		...section('Unverifiable:', result.unverifiable),
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
		...rest.flatMap((report) => {
			const result = checkCompatibility(first!, report, 'merge', []);
			const line = (diff: FieldDiff) => `${diff.field}: ${diff.a} → ${diff.b}`;

			return [
				...result.refused.map((diff) => `${report.name} differs from ${first!.name} in ${line(diff)}`),
				...result.unverifiable.map((diff) => `${report.name} cannot be checked against ${first!.name} in ${line(diff)}`)
			];
		}),
		...splitHeads(reports).map((ids) => `one PR at two heads: ${ids}`),
		...(duplicates.length
			? [
					`run ids listed more than once (${duplicates.length}): ${duplicates.slice(0, 3).join(', ')}${duplicates.length > 3 ? ', …' : ''}; a run counted twice would sum its defects as new ones`
				]
			: [])
	];
}
