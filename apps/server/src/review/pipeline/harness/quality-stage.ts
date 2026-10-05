import { buildRuleLedger } from '../../guidelines/ledger/ledger.js';
import { runDetectors, runDiagnostics } from '../detectors/detectors.js';
import type { DetectorResult } from '../detectors/types.js';
import { publishBudget, type ReviewRun } from './context.js';
import { addDetections } from './verification.js';

const TASK = { id: 'quality', label: "Checking the repo's rules" } as const;

function plural(count: number, word: string): string {
	return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function errorText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * The repo's guidelines as numbered rules, before the reviewers start, since
 * they review against them. Never throws: a failed build leaves no ledger.
 */
export async function ruleLedgerStage(run: ReviewRun): Promise<void> {
	if (run.controller.signal.aborted) return;

	run.task(TASK.id, TASK.label, 'running', "Reading the repo's guidelines", { kind: 'checks' });

	try {
		run.ledger = await buildRuleLedger(run);
	} catch (err) {
		run.ledger = null;
		run.events?.onLog?.(`Rule ledger skipped: ${errorText(err)}`);
	}

	publishBudget(run);
	run.task(TASK.id, TASK.label, 'done', plural(run.ledger?.rules.length ?? 0, 'rule'), { kind: 'checks' });
}

/** Hands new detector results to the verify queue and reports the running total on the task row. */
function report(run: ReviewRun, results: DetectorResult[]): void {
	run.detections.push(...results);
	addDetections(run, results);

	const rules = run.ledger?.rules.length ?? 0;

	run.task(
		TASK.id,
		TASK.label,
		'done',
		`${plural(rules, 'rule')} · ${plural(run.detections.length, 'deterministic result')}`,
		{ kind: 'checks' }
	);
}

/**
 * The detectors that read only the change, run alongside the reviewers so
 * their results are verified early. Never throws: a failed run leaves no
 * detections and the review runs on.
 */
export async function detectorStage(run: ReviewRun): Promise<void> {
	if (run.controller.signal.aborted) return;

	run.task(TASK.id, TASK.label, 'running', 'Running deterministic checks on the changed lines', { kind: 'checks' });

	let results: DetectorResult[] = [];

	try {
		results = await runDetectors(run);
	} catch (err) {
		run.events?.onLog?.(`Detectors skipped: ${errorText(err)}`);
	}

	report(run, results);
}

/**
 * The type check and lint diagnostics, once the baseline checks are in.
 * Synchronous, so the caller can decide between running it and closing the
 * review without the two interleaving.
 */
export function diagnosticStage(run: ReviewRun): void {
	if (run.controller.signal.aborted) return;

	try {
		report(run, runDiagnostics(run));
	} catch (err) {
		run.events?.onLog?.(`Diagnostics skipped: ${errorText(err)}`);
	}
}
