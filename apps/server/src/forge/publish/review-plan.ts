import {
	evidenceClass,
	FINDING_SEVERITIES,
	type AutoReviewSettings,
	type Finding,
	type ReviewFindingComment
} from '@recoder/shared';
import { matchesGlob } from '../../review/chat/directive';
import { inlineTarget } from './finding-comment';
import type { InlineTarget } from './forge';
import { findingMarker } from './render';
import { suggestedChange, type SuggestedChange } from './suggestion';

/** One finding to post on its diff line, with the suggestion its patch makes when it makes one. */
export interface InlinePlan {
	finding: Finding;
	marker: string;
	target: InlineTarget;
	/** Lines above `target` the comment covers; a suggestion's range, else 0. */
	span: number;
	suggestion: SuggestedChange | null;
}

/** What a finished review posts, decided before anything is sent. */
export interface ReviewPlan {
	/** Findings that go on their diff lines, worst first, at most the configured cap. */
	inline: InlinePlan[];
	/** Findings the summary lists instead: no shown diff line to anchor to, or past the cap. */
	listed: Finding[];
	/** Findings already on the pull request, by finding id, with the comment that shows them. Nothing is posted for them. */
	carried: Record<string, ReviewFindingComment>;
}

export interface PlanInput {
	/** The review's findings. Only reportable ones are planned. */
	findings: readonly Finding[];
	/** The pull request's diff, which decides which lines a comment can sit on. */
	pullDiff: string | undefined;
	settings: Pick<AutoReviewSettings, 'ignoredPaths' | 'maxInlineComments'>;
	/** Comments already on the pull request, by finding marker: found there, or recorded by an earlier review. */
	posted: ReadonlyMap<string, ReviewFindingComment>;
	/** An earlier review of the pull request submitted its findings, so a finding carried from it was shown there. */
	reportedBefore: boolean;
}

/** Every severity, worst first. */
const WORST_FIRST = [...FINDING_SEVERITIES].reverse();

/**
 * The findings a forge review may show and the check counts: verified, not
 * dismissed, not quieted by the repository's feedback, and outside the
 * ignored paths. Worst first.
 */
export function reportableFindings(findings: readonly Finding[], ignoredPaths: readonly string[]): Finding[] {
	return findings
		.filter(
			(finding) =>
				evidenceClass(finding) !== 'unverified' &&
				finding.decision?.state !== 'dismissed' &&
				!finding.topic?.quieted &&
				!isIgnoredPath(finding.file, ignoredPaths)
		)
		.sort((a, b) => WORST_FIRST.indexOf(a.severity) - WORST_FIRST.indexOf(b.severity));
}

function isIgnoredPath(path: string, ignoredPaths: readonly string[]): boolean {
	return ignoredPaths.some((glob) => matchesGlob(path, glob));
}

/**
 * Split the reportable findings into inline comments, summary entries and
 * findings already on the pull request. A finding is not posted again when a
 * comment for it exists, or when it was carried from an earlier review that
 * submitted its findings. A suggestion's range anchors the comment when the
 * patch makes one; else the finding's own line, when the diff shows it.
 */
export function planFindingsReview(input: PlanInput): ReviewPlan {
	const plan: ReviewPlan = { inline: [], listed: [], carried: {} };

	for (const finding of reportableFindings(input.findings, input.settings.ignoredPaths)) {
		const marker = findingMarker(finding);
		const known = input.posted.get(marker);

		if (known) {
			plan.carried[finding.id] = known;
			continue;
		}

		if (shownBefore(finding, input.reportedBefore)) continue;

		const inline = plan.inline.length < input.settings.maxInlineComments && anchor(finding, marker, input.pullDiff);

		if (inline) plan.inline.push(inline);
		else plan.listed.push(finding);
	}

	return plan;
}

/** A finding the identity history says an earlier review reported, when that review's findings went up. */
function shownBefore(finding: Finding, reportedBefore: boolean): boolean {
	return reportedBefore && !!finding.history && finding.history.state !== 'new';
}

function anchor(finding: Finding, marker: string, pullDiff: string | undefined): InlinePlan | null {
	const suggestion = suggestedChange(finding, pullDiff);

	if (suggestion) return { finding, marker, target: suggestion.target, span: suggestion.span, suggestion };

	const target = inlineTarget(finding, pullDiff);

	return target ? { finding, marker, target, span: 0, suggestion: null } : null;
}
