/** The cheapest way to measure a change, cheapest first. */
const MODES = ['rescore', 'replay', 'reverify', 'full'] as const;

export type EvalMode = (typeof MODES)[number];

const SRC = 'apps/server/src/';
const PIPELINE = `${SRC}review/pipeline/`;

/**
 * What each path can change, by prefix. A path matching none of these needs a
 * full run, so a new folder is safe until someone maps it. The stages run
 * after the reviewers, so a change there does not need them again.
 */
const RULES: ReadonlyArray<{ prefix: string; mode: EvalMode }> = [
	{ prefix: 'apps/server/tests/', mode: 'rescore' },
	{ prefix: `${SRC}eval/benchmark-score.ts`, mode: 'rescore' },
	{ prefix: `${SRC}eval/benchmark-stages.ts`, mode: 'rescore' },
	{ prefix: `${SRC}eval/benchmark-lows.ts`, mode: 'rescore' },
	{ prefix: `${SRC}eval/benchmark-labels`, mode: 'rescore' },
	{ prefix: `${SRC}eval/benchmark-report`, mode: 'rescore' },
	{ prefix: `${SRC}eval/benchmark-judge.ts`, mode: 'rescore' },
	{ prefix: `${SRC}eval/metrics.ts`, mode: 'rescore' },
	{ prefix: `${SRC}eval/report.ts`, mode: 'rescore' },
	{ prefix: `${PIPELINE}detectors/`, mode: 'replay' },
	{ prefix: `${PIPELINE}consolidate`, mode: 'replay' },
	{ prefix: `${PIPELINE}verify/`, mode: 'reverify' },
	{ prefix: `${PIPELINE}verify.ts`, mode: 'reverify' },
	{ prefix: `${PIPELINE}quality-verify.ts`, mode: 'reverify' }
];

/** The cheapest mode that covers a change to `path`. */
export function modeOfPath(path: string): EvalMode {
	return RULES.find((rule) => path.startsWith(rule.prefix))?.mode ?? 'full';
}

/** The cheapest mode that covers every path, and the paths that forced it; nothing changed is a rescore. */
export function pickMode(paths: readonly string[]): { mode: EvalMode; decidedBy: string[] } {
	const modes = paths.map((path) => ({ path, mode: modeOfPath(path) }));
	const mode = MODES[Math.max(0, ...modes.map((entry) => MODES.indexOf(entry.mode)))]!;

	return { mode, decidedBy: modes.filter((entry) => entry.mode === mode).map((entry) => entry.path) };
}
