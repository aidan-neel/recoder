import {
	categoryLabel,
	EVIDENCE_LABELS,
	evidenceClass,
	findingTone,
	splitCategoryTag,
	type BaseComparisonResult,
	type Finding,
	type FindingVerification,
	type Review,
	type VerificationBaseline
} from '@recoder/shared';

import type { Vote } from '../pull/session-state';
import type { BugProof, BugTone, BugView } from './types';

/** How the proving command ended on the base branch, by what the comparison found. */
const BASE_SENTENCE: Record<BaseComparisonResult, string> = {
	regression: 'Passes on the base branch.',
	'pre-existing': 'Fails the same way on the base branch.',
	incompatible: 'Can’t run on the base branch, which lacks the new code.',
	environment: 'Fails on the base branch before it reaches the check.',
	worsened: 'Already fails on the base branch; this change makes it worse.',
	unstable: 'Ends differently from run to run on the base branch.'
};

const SEVERITY: Record<BugTone, string> = { high: 'High', medium: 'Medium', low: 'Low' };

/** How many folders of a path `where` keeps before the file name. */
const KEPT_FOLDERS = 2;

/** The comparison with the base branch as one sentence; null when the run was not compared. */
export function baseSentence(baseline: VerificationBaseline | undefined): string | null {
	if (!baseline) return null;
	if (baseline.result) return BASE_SENTENCE[baseline.result];
	if ('unavailable' in baseline) return baseline.unavailable;

	return baseline.differs ? 'Ends differently on the base branch.' : 'Ends the same way on the base branch.';
}

/** `review/session/lease.ts:20`: the file with its nearest folders, the long prefix dropped. */
export function shortWhere(file: string, line: number | null): string {
	const kept = file
		.split('/')
		.slice(-(KEPT_FOLDERS + 1))
		.join('/');

	return line === null ? kept : `${kept}:${line}`;
}

/** The finding's tone: an error is high, a warning medium, the rest low. */
function toneOf(finding: Finding): BugTone {
	const tone = findingTone(finding.severity);

	return tone === 'question' ? 'low' : tone;
}

/** The run behind a reproduced finding. Older reviews keep only the command, and the reason as its output. */
function proofOf(verification: FindingVerification | undefined): BugProof | null {
	const evidence = verification?.evidence;

	if (evidence) {
		return {
			command: evidence.command,
			exitCode: evidence.exitCode,
			expected: evidence.expected ?? null,
			output: evidence.observed,
			base: baseSentence(evidence.baseline)
		};
	}

	if (!verification?.command) return null;

	return {
		command: verification.command,
		exitCode: verification.exitCode ?? null,
		expected: null,
		output: verification.reason,
		base: null
	};
}

function fixOf(finding: Finding): BugView['fix'] {
	if (finding.patch) return { diff: finding.patch.diff, checks: finding.patch.checks };
	if (finding.suggestion) return { text: finding.suggestion };

	return null;
}

/** The first sentence of a message, for a finding older reviews saved without a title. */
function firstSentence(text: string): string {
	return /^[^.!?\n]+[.!?]?/.exec(text.trim())?.[0] ?? text;
}

/** One finding of the review as the Bugs tab shows it. */
export function bugView(finding: Finding, review: Pick<Review, 'findingComments'>, vote: Vote | null): BugView {
	const { tag, body } = splitCategoryTag(finding.message);
	const evidence = evidenceClass(finding);
	const tone = toneOf(finding);
	const line = finding.line ?? null;
	const posted = review.findingComments?.[finding.id];

	return {
		id: finding.id,
		kind: finding.kind === 'quality' && finding.patch ? 'suggestion' : 'bug',
		title: finding.title ?? firstSentence(body),
		tone,
		severity: SEVERITY[tone],
		category: categoryLabel(finding.category ?? tag ?? 'correctness'),
		file: finding.file,
		line,
		endLine: finding.endLine ?? line,
		where: shortWhere(finding.file, line),
		evidence,
		evidenceLabel: EVIDENCE_LABELS[evidence],
		explanation: body,
		proof: evidence === 'reproduced' ? proofOf(finding.verification) : null,
		trace:
			evidence === 'traced'
				? (finding.claim?.executionPath ?? []).map((step) => ({
						where: shortWhere(step.file, step.line),
						note: step.note ?? ''
					}))
				: [],
		rule: evidence === 'rule' ? (finding.rule ?? null) : null,
		fix: fixOf(finding),
		history: finding.history?.state ?? null,
		decision: finding.decision ?? null,
		posted: posted ? { url: posted.url } : null,
		vote
	};
}
