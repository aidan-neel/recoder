import type { FindingPatch, FindingSeverity, FindingVerification } from '@recoder/shared';
import type { ReportFinding } from '../report/report.js';
import { textWidth, type Surface } from '../terminal/surface.js';
import { indent, wrapText } from '../terminal/text.js';
import { findingLocation, findingTitle } from './finding-heading.js';
import { prose } from './text-prose.js';

/** Where a finding's body starts, under its heading. */
const BODY_INDENT = 2;

/** A tab in a patch is shown this wide: a terminal's own eight columns push the code off the screen. */
const TAB = '    ';

/** How each way of proving a finding reads after "verified". */
const METHOD_PHRASES: Record<NonNullable<FindingVerification['method']>, string> = {
	run: 'by running it',
	trace: 'by tracing the code',
	detector: 'by a detector',
	rule: 'by a repository rule',
	convention: 'by the code around it'
};

/** A finding as a block of lines: its heading, where it is and how it was checked, the message, the suggestion, the patch. */
export function findingLines(finding: ReportFinding, surface: Surface): string[] {
	const { paint, glyphs } = surface;
	const width = textWidth(surface, BODY_INDENT * 2);
	const severity = severityPaint(finding.severity, surface);
	const heading = `${severity(`${glyphs.dot} ${finding.severity}`)}  ${paint.strong(findingTitle(finding))}`;
	const topic = topicOf(finding);

	const where = [
		findingLocation(finding),
		topic === null ? null : paint.muted(topic),
		verificationPhrase(finding.verification, surface)
	].filter((part) => part !== null);

	const body = [
		where.join(paint.muted(` ${glyphs.separator} `)),
		'',
		...prose(withoutTopicTag(finding.message, topic), width, surface),
		...suggestionLines(finding.suggestion, width, surface),
		...verificationLines(finding.verification, width, surface),
		...patchLines(finding.patch, surface)
	];

	return [heading, ...indent(body, BODY_INDENT)];
}

/** The color of a severity, which its word always stands beside. */
export function severityPaint(severity: FindingSeverity, surface: Surface): (text: string) => string {
	const paints: Record<FindingSeverity, (text: string) => string> = {
		error: surface.paint.error,
		warning: surface.paint.warning,
		info: surface.paint.info
	};

	return paints[severity];
}

/** `verified by running it`, or `unverified`; nothing for a finding with no record of how it was checked. */
function verificationPhrase(verification: FindingVerification | undefined, surface: Surface): string | null {
	if (!verification) return null;

	if (verification.status === 'unverified') return surface.paint.warning('unverified');

	const how = verification.method ? ` ${METHOD_PHRASES[verification.method]}` : '';

	return surface.paint.ok(`verified${how}`);
}

/**
 * What proved the finding, and the command that did. Why a finding is unverified is one muted line: it is usually
 * the same for every finding of a review, and the summary says it too.
 */
function verificationLines(verification: FindingVerification | undefined, width: number, surface: Surface): string[] {
	const reason = verification?.reason.trim();

	if (!verification || !reason) return [];

	if (verification.status === 'unverified') return ['', ...wrapText(reason, width).map(surface.paint.muted)];

	const command = verification.command ? [`${surface.paint.muted('$')} ${verification.command}`] : [];

	return ['', surface.paint.muted('How it was verified'), ...prose(reason, width, surface), ...command];
}

/** What the finding is about: the lens that raised it, else its category. */
function topicOf(finding: ReportFinding): string | null {
	return finding.lens ?? finding.category ?? null;
}

/** The message without the `[topic]` tag reviewers start it with, which the line above it already shows. */
function withoutTopicTag(message: string, topic: string | null): string {
	const tag = topic === null ? null : `[${topic}]`;

	return tag !== null && message.trimStart().startsWith(tag) ? message.trimStart().slice(tag.length) : message;
}

function suggestionLines(suggestion: string | undefined, width: number, surface: Surface): string[] {
	if (!suggestion?.trim()) return [];

	return ['', surface.paint.muted('Suggestion'), ...prose(suggestion, width, surface)];
}

/** The checked diff behind a bar, added lines green and removed lines red, and the commands that passed with it. */
function patchLines(patch: FindingPatch | undefined, surface: Surface): string[] {
	if (!patch) return [];

	const { paint, glyphs } = surface;
	const checks = patch.checks.length > 0 ? ` ${glyphs.separator} passes ${patch.checks.join(', ')}` : '';
	const bar = paint.muted(glyphs.bar);

	return [
		'',
		paint.muted(`Patch${checks}`),
		...patch.diff
			.trimEnd()
			.split('\n')
			.map((line) => `${bar} ${diffLine(line.replaceAll('\t', TAB), surface)}`)
	];
}

function diffLine(line: string, { paint }: Surface): string {
	if (line.startsWith('+++') || line.startsWith('---')) return paint.strong(line);

	if (line.startsWith('+')) return paint.ok(line);

	if (line.startsWith('-')) return paint.error(line);

	return line.startsWith('@@') ? paint.code(line) : line;
}
