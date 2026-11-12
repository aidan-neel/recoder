import type { ParseArgsConfig, parseArgs } from 'node:util';
import { REASONING_EFFORTS, TOKEN_BUDGETS } from '@recoder/shared';
import type { Audience } from '../audience.js';
import { EXIT } from '../exit.js';
import { SEVERITIES } from '../output/severity.js';
import { SKILL_AGENTS } from '../skill/skills-folder.js';
import type { ProgressFormat, ReportFormat, ReviewTarget } from '../review/options.js';
import type { FlagTable, WholeNumberBounds } from './flag-table.js';
import { LENS_IDS, LEVER_IDS } from './lists.js';

/** What a flag takes when it is left out and the default is a value rather than the saved setting. */
export const REVIEW_DEFAULTS = {
	budget: 'low',
	minSeverity: 'info',
	failOn: 'never'
} as const;

/**
 * How a report and progress are written when no flag says: laid out for a terminal for a person, and as JSON with
 * plain progress lines for a program, which is what `-p` asks for.
 */
export const OUTPUT_DEFAULTS = {
	person: { format: 'text', progress: 'live' },
	program: { format: 'json', progress: 'text' }
} as const satisfies Record<Audience, { format: ReportFormat; progress: ProgressFormat }>;

export const REPORT_FORMATS = ['text', 'json', 'markdown'] as const satisfies readonly ReportFormat[];

export const PROGRESS_FORMATS = ['live', 'text', 'ndjson', 'none'] as const satisfies readonly ProgressFormat[];

export const FAIL_ON_CHOICES: readonly ('never' | (typeof SEVERITIES)[number])[] = ['never', ...SEVERITIES];

/**
 * The flags that name what to review in place of a commit range; at most one may be given. Each flag is named as the
 * target kind it selects, so the flag, the stored run and the report use one word.
 */
export const NON_RANGE_TARGETS = ['staged', 'uncommitted', 'pull', 'diff'] as const satisfies readonly Exclude<
	ReviewTarget['kind'],
	'range'
>[];

/** The characters of one file a reviewer may be let read at once. */
const MAX_FILE_CHARS_BOUNDS = { min: 1, max: 200_000 } as const satisfies WholeNumberBounds;

/** How many runs `recoder runs` lists when `--limit` is left out. */
export const DEFAULT_RUNS_LIMIT = 20;

/** How a report is written; `recoder review` and `recoder result` both take these. */
export const REPORT_FLAGS = {
	format: {
		type: 'string',
		group: 'output',
		choices: REPORT_FORMATS,
		description: `Report format. Default: ${OUTPUT_DEFAULTS.person.format}, or ${OUTPUT_DEFAULTS.program.format} with -p.`
	},
	output: {
		type: 'string',
		group: 'output',
		value: 'file',
		description: 'Write the report here. With -p, standard output then gets one JSON line naming the file.'
	},
	'min-severity': {
		type: 'string',
		group: 'output',
		choices: SEVERITIES,
		description: `Leave out findings below this. Default: ${REVIEW_DEFAULTS.minSeverity}.`
	},
	'include-unconfirmed': {
		type: 'boolean',
		group: 'output',
		description: 'Also write findings the review could not confirm.'
	},
	'fail-on': {
		type: 'string',
		group: 'output',
		choices: FAIL_ON_CHOICES,
		description: `Exit ${EXIT.findings} on a written finding at or above this. Default: ${REVIEW_DEFAULTS.failOn}.`
	}
} as const satisfies FlagTable;

/** Every flag of `recoder review` that has help, in the order and groups of its help. */
export const REVIEW_FLAGS = {
	repo: {
		type: 'string',
		group: 'target',
		value: 'path',
		description: 'Repository directory. Default: the working directory.'
	},
	base: {
		type: 'string',
		group: 'target',
		value: 'ref',
		description: 'Compare against this ref. Default: the default branch.'
	},
	head: { type: 'string', group: 'target', value: 'ref', description: 'Last commit to review. Default: HEAD.' },
	staged: { type: 'boolean', group: 'target', description: 'Review what is staged.' },
	uncommitted: {
		type: 'boolean',
		group: 'target',
		description: 'Review all uncommitted changes, untracked files included.'
	},
	pull: {
		type: 'string',
		group: 'target',
		value: 'number or url',
		description: 'Review a pull or merge request on the repository forge.'
	},
	diff: {
		type: 'string',
		group: 'target',
		value: 'file or -',
		description: 'Review a unified diff from a file, or from standard input when the value is -. No code runs.'
	},
	include: {
		type: 'string',
		multiple: true,
		group: 'scope',
		value: 'glob',
		description: 'Review only matching paths. Repeatable.'
	},
	exclude: {
		type: 'string',
		multiple: true,
		group: 'scope',
		value: 'glob',
		description: 'Skip matching paths. Repeatable.'
	},
	title: { type: 'string', group: 'intent', value: 'text', description: 'What the change is called.' },
	body: { type: 'string', group: 'intent', value: 'text', description: 'What the change is meant to do.' },
	'body-file': {
		type: 'string',
		group: 'intent',
		value: 'path',
		description: 'Read the body from a file. Not with --body.'
	},
	instructions: {
		type: 'string',
		group: 'intent',
		value: 'text',
		description: 'What to look for or leave out. Costs one model call.'
	},
	'instructions-file': {
		type: 'string',
		group: 'intent',
		value: 'path',
		description: 'Read the instructions from a file. Not with --instructions.'
	},
	budget: {
		type: 'string',
		group: 'tuning',
		choices: TOKEN_BUDGETS,
		description: `How much to spend. Default: ${REVIEW_DEFAULTS.budget}.`
	},
	subagents: {
		type: 'string',
		group: 'tuning',
		value: 'n|uncapped',
		bounds: { min: 0 },
		description: "Most subagents the review may run. Default: the budget's cap."
	},
	reviewer: {
		type: 'string',
		group: 'tuning',
		value: 'model id',
		description: 'Model the reviewers run on. Default: the saved Review model. List the ids with recoder models.'
	},
	worker: {
		type: 'string',
		group: 'tuning',
		value: 'model id',
		description:
			'Model the subagents run on; verifiers follow the Review model unless --verifier is given. Default: the saved pick.'
	},
	verifier: {
		type: 'string',
		group: 'tuning',
		value: 'model id',
		description: 'Model the verifiers run on. Default: the saved pick, else the Review model.'
	},
	'reviewer-effort': {
		type: 'string',
		group: 'tuning',
		value: 'level',
		choices: REASONING_EFFORTS,
		description: `Reviewer reasoning effort: ${REASONING_EFFORTS.join(', ')}. Default: the budget's.`
	},
	'worker-effort': {
		type: 'string',
		group: 'tuning',
		value: 'level',
		choices: REASONING_EFFORTS,
		description: "Worker reasoning effort, same levels. Default: the budget's."
	},
	lens: {
		type: 'string',
		multiple: true,
		group: 'tuning',
		value: 'id',
		choices: LENS_IDS,
		description: `Run only these lenses. Repeatable or comma-separated. Default: all.\nLenses: ${LENS_IDS.join(', ')}.`
	},
	'skip-lens': {
		type: 'string',
		multiple: true,
		group: 'tuning',
		value: 'id',
		choices: LENS_IDS,
		description: 'Run every lens but these. Not with --lens.'
	},
	'low-severity': {
		type: 'boolean',
		group: 'tuning',
		description: 'Keep low-severity findings. Default: the saved setting.'
	},
	'no-low-severity': { type: 'boolean', group: 'tuning', description: 'Drop low-severity findings.' },
	'no-exec': {
		type: 'boolean',
		group: 'tuning',
		description: 'Read only: run no code, so bugs are reported unverified.'
	},
	'no-baseline-cache': { type: 'boolean', group: 'tuning', description: 'Run every baseline check again.' },
	'max-file-chars': {
		type: 'string',
		group: 'tuning',
		value: 'n',
		bounds: MAX_FILE_CHARS_BOUNDS,
		description: `Characters of one file a reviewer reads at once, ${MAX_FILE_CHARS_BOUNDS.min} to ${MAX_FILE_CHARS_BOUNDS.max}. Default: the saved setting.`
	},
	enable: {
		type: 'string',
		multiple: true,
		group: 'tuning',
		value: 'lever',
		choices: LEVER_IDS,
		description: `Switch on optional stages. Repeatable or comma-separated.\nLevers: ${LEVER_IDS.join(', ')}.`
	},
	timeout: {
		type: 'string',
		group: 'tuning',
		value: 'minutes',
		description: "Stop the review after this long. Default: the pipeline's own limit."
	},
	'keep-checkout': { type: 'boolean', group: 'tuning', description: 'Leave the throwaway checkout on disk.' },
	...REPORT_FLAGS,
	progress: {
		type: 'string',
		group: 'running',
		choices: PROGRESS_FORMATS,
		description: `Progress on standard error. ${OUTPUT_DEFAULTS.person.progress} redraws in place on a terminal.\nDefault: ${OUTPUT_DEFAULTS.person.progress}, or ${OUTPUT_DEFAULTS.program.progress} with -p.`
	},
	detach: {
		type: 'boolean',
		group: 'running',
		description: 'Start the review in the background, print its run and exit at once.\nNot with --diff -.'
	}
} as const satisfies FlagTable;

/** `recoder wait`: how long to wait. */
export const WAIT_FLAGS = {
	timeout: {
		type: 'string',
		group: 'flags',
		value: 'minutes',
		description: 'Stop waiting after this long. Default: wait until the run ends.'
	}
} as const satisfies FlagTable;

/** `recoder runs`: which repository's runs, and how many to list. */
export const LIST_FLAGS = {
	repo: {
		type: 'string',
		group: 'flags',
		value: 'path',
		description: 'List only the runs of this repository directory. Default: every repository.'
	},
	limit: {
		type: 'string',
		group: 'flags',
		value: 'n',
		bounds: { min: 1 },
		description: `List at most this many runs. Default: ${DEFAULT_RUNS_LIMIT}.`
	}
} as const satisfies FlagTable;

/** `recoder models`: which of the accepted models to list. */
export const MODELS_FLAGS = {
	provider: {
		type: 'string',
		multiple: true,
		group: 'flags',
		value: 'name',
		description:
			'List only the models of these providers, ignoring case. Repeatable or comma-separated. Default: every provider.'
	},
	search: {
		type: 'string',
		group: 'flags',
		value: 'text',
		description: 'List only models whose id or name contains this text, ignoring case.'
	}
} as const satisfies FlagTable;

/** `recoder init`: where to set Recoder up, and for which agents. */
export const INIT_FLAGS = {
	project: {
		type: 'boolean',
		group: 'flags',
		description: 'Set up this folder, to commit with the repository.'
	},
	global: {
		type: 'boolean',
		group: 'flags',
		description: 'Set up this machine, for every project.'
	},
	agent: {
		type: 'string',
		multiple: true,
		group: 'flags',
		choices: SKILL_AGENTS,
		description:
			'Whose skills folder gets the skill: claude for Claude Code, agents for Codex, OpenCode and others that read .agents/skills.\nRepeatable or comma-separated. Default: the agents found on this machine.'
	},
	reviewer: {
		type: 'string',
		group: 'flags',
		value: 'model id',
		description: 'Save this as the model reviews run on. List the ids with recoder models.'
	},
	mcp: {
		type: 'boolean',
		group: 'flags',
		description: 'With --project: also add the recoder MCP server to .mcp.json, for agents that call tools.'
	},
	'no-guidelines': {
		type: 'boolean',
		group: 'flags',
		description: 'With --project: do not create RECODER.md.'
	},
	force: {
		type: 'boolean',
		group: 'flags',
		description: 'Replace an installed skill or MCP entry that differs from this version.'
	},
	yes: {
		type: 'boolean',
		group: 'flags',
		description: 'Ask nothing and take the defaults. Replaces an installed skill that differs.'
	}
} as const satisfies FlagTable;

/** `recoder upgrade`: which release to install, and whether to install it. */
export const UPGRADE_FLAGS = {
	to: {
		type: 'string',
		group: 'flags',
		value: 'release',
		description: 'Install this release, such as v0.2.0, newer or older. Default: the latest release.'
	},
	check: {
		type: 'boolean',
		group: 'flags',
		description: 'Only say whether a newer release exists. Nothing is installed.'
	}
} as const satisfies FlagTable;

/** The internal flag that hands a background `recoder review` its run id. It has no help row. */
export const RUN_ID_FLAG = 'run-id';

/** Every flag `recoder review` takes, as `parseArgs` reads them. Value checks happen after parsing. */
export const REVIEW_PARSE_CONFIG = {
	options: { ...REVIEW_FLAGS, [RUN_ID_FLAG]: { type: 'string' } },
	strict: true,
	allowPositionals: false
} as const satisfies ParseArgsConfig;

/** What `parseArgs` returns for `recoder review`. */
export type ReviewFlagValues = ReturnType<typeof parseArgs<typeof REVIEW_PARSE_CONFIG>>['values'];

/** What `parseArgs` returns for the report flags alone. */
export type ReportFlagValues = ReturnType<typeof parseArgs<{ options: typeof REPORT_FLAGS }>>['values'];
