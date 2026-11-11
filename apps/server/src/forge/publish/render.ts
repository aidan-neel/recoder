import { createHash } from 'node:crypto';
import {
	assignmentCounts,
	FINDING_SEVERITIES,
	REVIEW_CANCELLED,
	reviewStage,
	splitCategoryTag,
	type Finding,
	type FindingSeverity,
	type ReviewProgress
} from '@recoder/shared';
import { RECODER_MARKER } from '../watch/mention';

/**
 * Markdown for Recoder's comments on a pull request. Pure: everything comes
 * in through the view, so the same review always renders the same body.
 */

/** Where a finding's location links: the pull request's diff on its forge. */
interface DiffLinkTarget {
	provider: 'github' | 'gitlab';
	prUrl: string | null;
}

/** What the summary comment shows. */
export interface PullCommentView extends DiffLinkTarget {
	prNumber: number;
	headSha: string;
	status: 'running' | 'passed' | 'failed';
	summary: string | null;
	findings: Finding[];
	/** Live progress while the review runs. */
	progress?: ReviewProgress;
	/** The person who asked for the review, without `@`. */
	requestedBy?: string;
	/** The forge's longest comment. */
	limit: number;
}

/** Every severity, worst first: the order findings are listed in. */
const SEVERITY_ORDER: readonly FindingSeverity[] = [...FINDING_SEVERITIES].reverse();

const SEVERITY_HEADING: Record<FindingSeverity, string> = {
	error: 'Errors',
	warning: 'Warnings',
	info: 'Low severity'
};

const SEVERITY_WORD: Record<FindingSeverity, string> = { error: 'Error', warning: 'Warning', info: 'Low' };

/** Hidden in the summary comment, so a later run (or a restart) finds and edits it instead of posting another. */
export function pullCommentMarker(prNumber: number): string {
	return `<!-- recoder:review pr=${prNumber} -->`;
}

/** Hidden in a finding's comment, keyed by its fingerprint, so posting it again edits it. */
export function findingMarker(finding: Finding): string {
	return `<!-- recoder:finding ${(finding.fingerprint ?? finding.id).replace(/[^\w:.-]/g, '')} -->`;
}

/** The short commit, or null before the review has resolved the head. */
function shortSha(sha: string): string | null {
	return sha && sha !== 'unknown' ? sha.slice(0, 7) : null;
}

/**
 * Model prose with every `@name` broken by a zero-width space, so a review
 * never pings anyone or summons a bot (Recoder included) by quoting a handle.
 */
function quiet(text: string): string {
	return text.replace(/(^|[^\w`])@(?=[\w-])/g, '$1@​');
}

/** `src/a.ts:12-14`, or the file alone without a line. */
function locationText(finding: Finding): string {
	if (!finding.line) return finding.file;

	const end = finding.endLine && finding.endLine > finding.line ? `-${finding.endLine}` : '';

	return `${finding.file}:${finding.line}${end}`;
}

/**
 * The finding's place in the pull request's diff. GitHub anchors a line
 * (`#diff-<sha256 of path>R12`); GitLab only the file (`#<sha1 of path>`).
 */
function diffLink(target: DiffLinkTarget, finding: Finding): string | null {
	if (!target.prUrl) return null;

	const url = target.prUrl.replace(/\/+$/, '');

	if (target.provider === 'gitlab') return `${url}/diffs#${createHash('sha1').update(finding.file).digest('hex')}`;

	const side = finding.side === 'old' ? 'L' : 'R';
	const line = finding.line ? `${side}${finding.line}` : '';

	return `${url}/files#diff-${createHash('sha256').update(finding.file).digest('hex')}${line}`;
}

function linkedLocation(target: DiffLinkTarget, finding: Finding): string {
	const text = `\`${locationText(finding).replace(/`/g, '')}\``;
	const link = diffLink(target, finding);

	return link ? `[${text}](${link})` : text;
}

/** The finding's heading line: its title, else its message's first line. */
function findingTitle(finding: Finding): string {
	const body = splitCategoryTag(finding.message).body;

	return quiet((finding.title || body.split('\n')[0] || 'Finding').trim());
}

/** The message and suggestion under a finding's heading. */
function findingDetail(finding: Finding): string[] {
	const body = splitCategoryTag(finding.message).body.trim();
	const parts = body && body !== finding.title ? [quiet(body)] : [];

	if (finding.suggestion?.trim()) parts.push(`**Suggestion:** ${quiet(finding.suggestion.trim())}`);

	return parts;
}

function findingBlock(target: DiffLinkTarget, finding: Finding): string {
	return [`**${findingTitle(finding)}** · ${linkedLocation(target, finding)}`, ...findingDetail(finding)].join('\n\n');
}

/** "2 errors · 1 warning", for the line above the findings. */
function tally(findings: Finding[]): string {
	const words: Record<FindingSeverity, [string, string]> = {
		error: ['error', 'errors'],
		warning: ['warning', 'warnings'],
		info: ['low', 'low']
	};

	return SEVERITY_ORDER.flatMap((severity) => {
		const count = findings.filter((finding) => finding.severity === severity).length;

		return count ? [`${count} ${words[severity][count === 1 ? 0 : 1]}`] : [];
	}).join(' · ');
}

/** Findings by severity; low ones fold into a closed `<details>`. */
function findingSections(view: PullCommentView, shown: Finding[]): string[] {
	return SEVERITY_ORDER.flatMap((severity) => {
		const group = shown.filter((finding) => finding.severity === severity);

		if (!group.length) return [];

		const blocks = group.map((finding) => findingBlock(view, finding)).join('\n\n');
		const heading = `${SEVERITY_HEADING[severity]} (${group.length})`;

		if (severity === 'info') return [`<details>\n<summary>${heading}</summary>\n\n${blocks}\n\n</details>`];

		return [`#### ${heading}\n\n${blocks}`];
	});
}

function headline(view: PullCommentView): string {
	const sha = shortSha(view.headSha);

	if (view.status === 'running') return sha ? `Reviewing \`${sha}\`…` : 'Reviewing…';
	if (view.status === 'failed') return view.summary === REVIEW_CANCELLED ? 'Review cancelled' : 'Review failed';

	return sha ? `Reviewed \`${sha}\`` : 'Reviewed';
}

/** Where a running review stands: its stage, reviewers done and candidates raised. */
function progressLine(progress: ReviewProgress | undefined): string {
	if (!progress) return 'Starting…';

	const stage = reviewStage(progress, 'running');
	const reviewers = assignmentCounts(progress.assignments);
	const parts = [stage.label];

	if (reviewers.total) parts.push(`${reviewers.complete + reviewers.failed} of ${reviewers.total} reviewers done`);

	if (progress.candidateCount)
		parts.push(`${progress.candidateCount} possible ${progress.candidateCount === 1 ? 'issue' : 'issues'} to verify`);

	return parts.join(' · ');
}

function footer(view: PullCommentView): string {
	const parts = ['Recoder'];

	if (view.requestedBy) parts.push(`requested by @${view.requestedBy.replace(/^@+/, '')}`);
	if (view.status === 'running') parts.push('this comment updates as the review runs');

	return `<sub>${parts.join(' · ')}</sub>`;
}

/** The body with the first `shown` findings, and a note for the rest. */
function compose(view: PullCommentView, ordered: Finding[], shown: number, summary: string | null): string {
	const sections = [pullCommentMarker(view.prNumber), RECODER_MARKER, `### Recoder · ${headline(view)}`];

	if (view.status === 'running') sections.push(progressLine(view.progress));
	if (summary?.trim()) sections.push(quiet(summary.trim()));

	if (view.status !== 'running' && ordered.length) {
		sections.push(`**${tally(ordered)}**`, ...findingSections(view, ordered.slice(0, shown)));

		const hidden = ordered.length - shown;

		if (hidden > 0)
			sections.push(`_${hidden} more ${hidden === 1 ? 'finding' : 'findings'} didn’t fit in this comment._`);
	} else if (view.status === 'passed') {
		sections.push('No issues found.');
	}

	sections.push('---', footer(view));

	return sections.join('\n\n');
}

/** Findings worst first, so the ones a short comment drops are the lowest. */
function bySeverity(findings: Finding[]): Finding[] {
	return [...findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}

/**
 * The summary comment. Over the forge's limit it drops findings from the
 * lowest severity up with a note, then cuts the summary itself.
 */
export function renderPullComment(view: PullCommentView): string {
	const ordered = bySeverity(view.findings);
	let shown = ordered.length;
	let body = compose(view, ordered, shown, view.summary);

	while (body.length > view.limit && shown > 0) {
		shown--;
		body = compose(view, ordered, shown, view.summary);
	}

	if (body.length <= view.limit) return body;

	const overflow = body.length - view.limit + 40;
	const summary = view.summary ?? '';

	return compose(
		view,
		ordered,
		0,
		`${summary.slice(0, Math.max(0, summary.length - overflow))}\n\n_(summary cut short)_`
	);
}

/** What a finding's own comment shows. `inline` comments sit on the line, so they leave the location out. */
export interface FindingCommentView extends DiffLinkTarget {
	finding: Finding;
	headSha: string;
	inline: boolean;
	limit: number;
}

export function renderFindingComment(view: FindingCommentView): string {
	const { finding } = view;
	const heading = `**${SEVERITY_WORD[finding.severity]} · ${findingTitle(finding)}**`;
	const sha = shortSha(view.headSha);

	const body = [
		findingMarker(finding),
		RECODER_MARKER,
		view.inline ? heading : `${heading} · ${linkedLocation(view, finding)}`,
		...findingDetail(finding),
		`<sub>From Recoder’s review${sha ? ` of \`${sha}\`` : ''}</sub>`
	].join('\n\n');

	return body.length <= view.limit ? body : `${body.slice(0, view.limit - 40)}\n\n_(cut short)_`;
}
