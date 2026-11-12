import {
	EVIDENCE_LABELS,
	evidenceClass,
	type BaseComparisonResult,
	type Finding,
	type FindingVerification,
	type VerificationBaseline
} from '@recoder/shared';
import { fenceBlock, inlineCode } from '../../cli/output/markdown-code';
import { clip, inertProse, quoteBlock } from './markdown';
import { locationText } from './render';

/**
 * What supports a finding, in the evidence terms the app uses (#74): the
 * command, its output and the base comparison for a reproduced finding; the
 * source path or the deterministic check for a traced one; the quoted rule and
 * its source for a rule finding. Everything from the model or the run is
 * escaped: fenced so it cannot close its block, quoted line by line, or with
 * `@` handles broken.
 */

/** Longest command shown, in characters. */
const MAX_COMMAND = 500;

/** Longest output excerpt shown, in characters. */
const MAX_OUTPUT = 1500;

/** Longest verifier reason shown, in characters. */
const MAX_REASON = 600;

const BASE_RESULT_TEXT: Record<BaseComparisonResult, string> = {
	regression: 'passes on the base commit and fails with this change.',
	'pre-existing': 'fails the same way on the base commit, so the problem predates this change.',
	worsened: 'already fails on the base commit; this change makes it worse or newly reachable.',
	incompatible: 'cannot run on the base commit, which lacks what it exercises.',
	environment: 'the base run failed in its environment before reaching the check.',
	unstable: 'repeated base runs disagree.'
};

/** The evidence section of a finding's comment. */
export function renderEvidence(finding: Finding): string {
	const evidence = evidenceClass(finding);
	const label = `**Evidence:** ${EVIDENCE_LABELS[evidence]}`;
	const verification = finding.verification;

	if (!verification) return label;
	if (evidence === 'reproduced') return [label, ...reproduced(verification)].join('\n\n');
	if (evidence === 'rule') return [label, ...ruleSupport(finding), ...reasonLine(verification)].join('\n\n');
	if (evidence === 'traced') return [label, ...traced(finding), ...reasonLine(verification)].join('\n\n');

	return [label, ...reasonLine(verification)].join('\n\n');
}

/** The proving command, the excerpt of its output, and how the base commit compares. */
function reproduced(verification: FindingVerification): string[] {
	const run = verification.evidence;
	const command = run?.command ?? verification.command;
	const parts: string[] = [];

	if (command) parts.push(`Command:\n\n${fenceBlock(clip(command, MAX_COMMAND), 'sh')}`);
	if (run?.observed.trim()) parts.push(`Output:\n\n${fenceBlock(clip(run.observed, MAX_OUTPUT), 'text')}`);
	if (run?.baseline) parts.push(`Base commit: ${baselineText(run.baseline)}`);

	return parts.length ? parts : reasonLine(verification);
}

function baselineText(baseline: VerificationBaseline): string {
	if (baseline.result) return BASE_RESULT_TEXT[baseline.result];
	if ('unavailable' in baseline) return `not compared: ${inertProse(clip(baseline.unavailable, MAX_REASON))}`;

	const exit = baseline.exitCode === null ? 'no exit code' : `exit code ${baseline.exitCode}`;

	return baseline.differs ? `${exit}, unlike this change.` : `${exit}, the same as this change.`;
}

/** A detector's name, or the code path the verifier traced. */
function traced(finding: Finding): string[] {
	if (finding.verification?.method === 'detector')
		return [`Deterministic check: ${inlineCode(finding.lens ?? 'detector')}`];

	const steps = finding.claim?.executionPath ?? [];

	if (!steps.length) return [];

	const lines = steps.map((step) => {
		const note = step.note?.trim() ? ` ${inertProse(step.note.trim())}` : '';

		return `- ${inlineCode(`${step.file}:${step.line}`)}${note}`;
	});

	return [`Source path:\n\n${lines.join('\n')}`];
}

/** The rule quoted word for word with where it is written; its ledger id alone on reviews older than quoting it. */
function ruleSupport(finding: Finding): string[] {
	const rule = finding.rule;

	if (!rule) return finding.ruleId ? [`Rule ${inlineCode(finding.ruleId)}`] : [];

	const source = locationText(rule.source.path, rule.source);

	return [quoteBlock(rule.text), `Rule ${inlineCode(rule.id)} from ${inlineCode(source)}`];
}

function reasonLine(verification: FindingVerification): string[] {
	const reason = verification.reason.trim();

	return reason ? [inertProse(clip(reason, MAX_REASON))] : [];
}
