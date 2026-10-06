import type { EvidenceRecord, EvidenceStore } from '../../../evidence/evidence.js';
import type { CandidateFinding } from '../consolidate.js';
import { SETUP_FAILURE, unresolved } from '../harness/run-outcome.js';

/** Characters of a run's output kept as the observed excerpt. */
const OBSERVED_CHARS = 600;

/** Lines of output kept around the line that shows the problem. */
const OBSERVED_LINES = 3;

/** An output line that reports a failure, for runs whose reason quotes nothing. */
const FAILURE_LINE = /\b(?:error|fail(?:ed|ure|s)?|assert\w*|expect\w*|received|exception|panic)\b|[✗✘]/i;

/** A `file:line` location, which verifiers are asked to name and which a run rarely prints. */
const LOCATION = /^[\w./@-]+:\d+(?:-\d+)?$/;

/** Spans the verifier quoted in backticks or double quotes, long enough to mean something. */
export function quotedSpans(reason: string): string[] {
	return [...reason.matchAll(/`([^`]{4,})`|"([^"]{4,})"/g)].map((match) => (match[1] ?? match[2] ?? '').trim());
}

/**
 * Spans the verifier says a run printed: quoted, and neither a `file:line`
 * location nor text of a command it ran.
 */
export function claimedOutput(reason: string, runs: EvidenceRecord[]): string[] {
	return quotedSpans(reason).filter(
		(span) => span && !LOCATION.test(span) && !runs.some((run) => run.command?.includes(span))
	);
}

/** A weak-test finding where code can run: its verifier plants the bug the test should catch. */
export function isMutationFinding(candidate: CandidateFinding, canRun: boolean): boolean {
	return candidate.category === 'tests' && canRun;
}

/** A run that exited nonzero. */
function failed(run: EvidenceRecord): boolean {
	return typeof run.exitCode === 'number' && run.exitCode !== 0;
}

/** A run's output, without its `$ command` line and `[exit …]` status line. */
export function runOutput(run: EvidenceRecord): string {
	return run.content.split('\n').slice(1, -1).join('\n');
}

/** Output of a planted bug that did not parse, so the test failed on the edit and not on the behavior. */
const BROKEN_EDIT = /SyntaxError|Unexpected token/;

/**
 * A failed run that never reached the code under test, so it settles nothing
 * either way: one recorded as setup-failed or unsupported execution, or one
 * whose output shows it. A syntax error counts only for a `mutation` run:
 * there it is the verifier's own edit, while a repro may fail on one as the
 * defect itself.
 */
export function brokeInSetup(run: EvidenceRecord, mutation = false): boolean {
	if (!failed(run)) return false;
	if (unresolved(run.outcome)) return true;

	const output = runOutput(run);

	return SETUP_FAILURE.test(output) || (mutation && BROKEN_EDIT.test(output));
}

/** A run that reached the code under test and exited nonzero there. */
export function failedOnTarget(run: EvidenceRecord, mutation = false): boolean {
	return failed(run) && !brokeInSetup(run, mutation);
}

/**
 * A run shows the defect when the repro failed on the code under test, or
 * when its output holds a span the verifier quoted. Quoting the command
 * itself proves nothing, and neither does a run that broke during setup.
 */
export function showsDefect(run: EvidenceRecord, reason: string): boolean {
	if (unresolved(run.outcome)) return false;
	if (failedOnTarget(run)) return true;

	const output = runOutput(run);

	return quotedSpans(reason).some((span) => span && !run.command?.includes(span) && output.includes(span));
}

/** The runs a verdict cites that its own verifier made; a baseline check or another agent's run never counts. */
export function ownRuns(evidenceIds: string[], evidence: EvidenceStore, agentId: string): EvidenceRecord[] {
	return evidenceIds
		.map((id) => evidence.get(id))
		.filter((record) => record !== undefined)
		.filter((record) => record.kind === 'run' && record.agentId === agentId);
}

/** Where in `lines` the output shows the problem: a line holding a quoted span, else the first failure line, else the end. */
function observedStart(lines: string[], spans: string[]): number {
	const quoted = lines.findIndex((line) => spans.some((span) => line.includes(span)));

	if (quoted >= 0) return quoted;

	const failure = lines.findIndex((line) => FAILURE_LINE.test(line));

	return failure >= 0 ? failure : Math.max(0, lines.length - OBSERVED_LINES - 1);
}

/**
 * A few lines of a run's own output that show what it printed: the lines at a
 * span the verifier quoted when one appears, else the first failure line, else
 * the end. Cut from the recorded run, never from the verifier's prose.
 */
export function observedExcerpt(run: EvidenceRecord, reason: string): string {
	const lines = runOutput(run)
		.split('\n')
		.map((line) => line.trimEnd())
		.filter(Boolean);

	const start = observedStart(lines, quotedSpans(reason));

	const excerpt = lines
		.slice(start, start + OBSERVED_LINES + 1)
		.join('\n')
		.trim();

	return excerpt.length > OBSERVED_CHARS ? `${excerpt.slice(0, OBSERVED_CHARS - 1)}…` : excerpt;
}
