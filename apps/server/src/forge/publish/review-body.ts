import type { Finding, ResolvedFinding } from '@recoder/shared';
import { RECODER_MARKER } from '../watch/mention';
import { renderEvidence } from './evidence';
import { clip, quiet } from './markdown';
import { findingDetail, findingHeadline, shortSha, tally, type DiffLinkTarget } from './render';

/** Longest reason shown for a fixed finding, in characters. */
const MAX_FIX_REASON = 300;

/** What the summary of a submitted findings review shows. */
export interface FindingsReviewView extends DiffLinkTarget {
	prNumber: number;
	headSha: string;
	/** Findings posted on their diff lines. */
	inline: readonly Finding[];
	/** Findings the summary lists in full: no line to anchor to, refused by the forge, or past the cap. */
	listed: readonly Finding[];
	/** Earlier findings this review shows fixed. */
	resolved: readonly ResolvedFinding[];
	/** The forge's longest comment. */
	limit: number;
}

/**
 * Hidden in the findings review, keyed by the pull request and its head
 * commit, so a repeated delivery or a second review of the same commit finds
 * it instead of submitting another.
 */
export function findingsReviewMarker(prNumber: number, headSha: string): string {
	return `<!-- recoder:findings pr=${prNumber} sha=${headSha.replace(/[^\w]/g, '')} -->`;
}

/**
 * The findings review's summary. Over the forge's limit it drops listed
 * findings from the lowest severity up with a note.
 */
export function renderFindingsReview(view: FindingsReviewView): string {
	let shown = view.listed.length;
	let body = compose(view, shown);

	while (body.length > view.limit && shown > 0) {
		shown--;
		body = compose(view, shown);
	}

	return body.length <= view.limit ? body : `${body.slice(0, view.limit - 40)}\n\n_(cut short)_`;
}

function compose(view: FindingsReviewView, shown: number): string {
	const sha = shortSha(view.headSha);
	const posted = [...view.inline, ...view.listed];
	const sections = [findingsReviewMarker(view.prNumber, view.headSha), RECODER_MARKER];

	sections.push(`### Recoder · Verified findings${sha ? ` on \`${sha}\`` : ''}`);
	if (posted.length) sections.push(`**${tally(posted)}**`);
	if (view.inline.length) sections.push(inlineNote(view.inline.length));
	if (view.listed.length) sections.push(...listedSection(view, shown));
	if (view.resolved.length) sections.push(resolvedSection(view));
	if (!posted.length && !view.resolved.length) sections.push('No new verified findings.');
	sections.push('---', '<sub>Recoder</sub>');

	return sections.join('\n\n');
}

function inlineNote(count: number): string {
	return count === 1 ? 'One finding is on its line below.' : `${count} findings are on their lines below.`;
}

/** The listed findings in full, evidence included, and a note for the ones that did not fit. */
function listedSection(view: FindingsReviewView, shown: number): string[] {
	const blocks = view.listed
		.slice(0, shown)
		.map((finding) =>
			[findingHeadline(view, finding), ...findingDetail(finding), renderEvidence(finding)].join('\n\n')
		);

	const hidden = view.listed.length - shown;

	const note =
		hidden > 0 ? [`_${hidden} more ${hidden === 1 ? 'finding' : 'findings'} didn’t fit in this comment._`] : [];

	return [`#### Other findings (${view.listed.length})`, ...blocks, ...note];
}

function resolvedSection(view: FindingsReviewView): string {
	const lines = view.resolved.map((item) => {
		const reason = item.reason.trim() ? `: ${quiet(clip(item.reason, MAX_FIX_REASON)).replace(/\s*\n\s*/g, ' ')}` : '';

		return `- ${findingHeadline(view, item.finding)}${reason}`;
	});

	return `#### Fixed since the last review (${view.resolved.length})\n\n${lines.join('\n')}`;
}
