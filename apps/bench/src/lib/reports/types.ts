import type { BenchmarkReport, JudgeModel, PrResult, ReviewerManifest, ScoredRun } from '$server/eval/benchmark-report';
import type { LabeledDefect, Totals } from '$server/eval/benchmark-score';
import type { ReasoningEffort } from '@recoder/shared';

export type { BenchmarkReport, JudgeModel, LabeledDefect, PrResult, ReviewerManifest, ScoredRun, Totals };

/** A machine the devtool reads reports from and starts runs on. */
export interface HostConfig {
	id: string;
	label: string;
	/** The ssh destination; null for this machine. */
	ssh: string | null;
	/** The Recoder checkout benchmarks run from. */
	repo: string;
	dataDir: string;
	datasetsDir: string;
	/** The Recoder server new runs use unless the form names another. */
	base: string;
	/** Directories put before PATH when a run starts there (bun, node, opencode). */
	path: string | null;
}

/** What the host list shows about each machine. */
export interface HostStatus {
	id: string;
	label: string;
	remote: boolean;
	/** Null when the host answered; the reason otherwise. */
	error: string | null;
	servers: ServerProcess[];
	runs: number;
	/** Reviews running on any of the host's servers. */
	reviews: number;
}

/** A Recoder server process on a host. */
export interface ServerProcess {
	pid: number;
	port: number;
	/** The checkout it runs from. */
	cwd: string;
}

/** A report's headline numbers, read once and kept until the file changes. */
export interface ReportEntry {
	/** `<host>/<file>`, the report's id in URLs. */
	key: string;
	host: string;
	hostLabel: string;
	file: string;
	dataset: string;
	startedAt: string;
	finishedAt: string;
	runsPerPr: number;
	prIds: string[];
	judge: JudgeModel;
	reviewer: ReviewerManifest | null;
	harnessCommit: string | null;
	/** Reports with the same config are the only ones whose scores compare. */
	config: ConfigKey;
	overall: Totals;
	byKind: Record<string, Totals>;
	/** Runs the report expects, counting the ones not yet done. */
	runsExpected: number;
	runsPassed: number;
	runsFailed: number;
	/** Shown findings over passed runs. */
	findings: number;
	unlabeled: number;
	/** Mean minutes per passed review. */
	meanReviewMinutes: number | null;
	/** Planted defects only a hidden candidate reported. */
	lost: number;
	defectStability: number | null;
}

/** The reviewer and judge a score came from. */
export interface ConfigKey {
	id: string;
	/** Short model and effort, like `gpt-6-luna medium`. */
	reviewer: string;
	judge: string;
}

/** A `bun src/eval/benchmark.ts` process on a host. */
export interface BenchmarkProcess {
	pid: number;
	/** When it started, from its elapsed time. */
	startedAt: string;
	cwd: string;
	args: string[];
	/** Where its stdout goes, when that is a file. */
	log: string | null;
}

/** A run in progress, as the active list shows it. */
export interface ActiveRun {
	/** `<host>/<pid>`. */
	key: string;
	host: string;
	hostLabel: string;
	pid: number;
	startedAt: string;
	cwd: string;
	dataset: string;
	only: string[] | null;
	runs: number;
	concurrency: number;
	base: string;
	judge: string;
	log: string | null;
	/** The report this run is writing, once its first review has been saved. */
	report: string | null;
	done: number;
	expected: number | null;
	found: number;
	planted: number;
	/** Reviews running for this run now. */
	reviews: LiveReview[];
}

/** A review running on a server, matched to a run when its PR and start time fit. */
export interface LiveReview {
	id: string;
	prNumber: number;
	/** The dataset PR id (`hono-3`) when the run's labels name it. */
	label: string | null;
	startedAt: string;
	tasksDone: number;
	tasksTotal: number;
	agents: number;
	/** Tasks running now, read from the review's progress when asked for. */
	tasks?: { label: string; message: string; startedAt: string | null }[];
	model?: string | null;
}

/** One labeled PR in a dataset, for the run form. */
export interface DatasetPr {
	id: string;
	codebase: string;
	defects: number;
}

/** A model a server offers, for the run form. */
export interface ModelOption {
	id: string;
	label: string;
	source: string | null;
	efforts: ReasoningEffort[];
	defaultEffort: ReasoningEffort | null;
}

/** The run form's request. */
export interface RunRequest {
	host: string;
	base: string;
	dataset: string;
	only: string[];
	/** Null keeps the server's current picks. */
	model: string | null;
	effort: ReasoningEffort | null;
	runs: number;
	concurrency: number;
	timeout: number;
	judge: string;
	judgeEffort: ReasoningEffort | null;
	tag: string;
}
