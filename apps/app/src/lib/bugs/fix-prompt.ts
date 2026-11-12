import type { PullRequest } from '@recoder/shared';

import type { BugView } from './types';

/** The location as a coding agent reads it: the full path and the line range. */
function location(bug: BugView): string {
	if (bug.line === null) return bug.file;

	return bug.endLine !== null && bug.endLine !== bug.line
		? `${bug.file}:${bug.line}-${bug.endLine}`
		: `${bug.file}:${bug.line}`;
}

/** What shows the finding holds: the run that reproduced it, the path that reaches it, or the rule it breaks. */
function evidenceLines(bug: BugView): string[] {
	if (bug.proof) {
		return [
			`Reproduce: \`${bug.proof.command}\` (exit ${bug.proof.exitCode ?? 'unknown'})`,
			'```',
			bug.proof.output,
			'```',
			...(bug.proof.base ? [`On the base branch: ${bug.proof.base}`] : [])
		];
	}

	if (bug.trace.length > 0)
		return ['How execution reaches it:', ...bug.trace.map((step) => `- ${step.where}: ${step.note}`)];
	if (bug.rule) return [`The repository rule it breaks (${bug.rule.source.path}): ${bug.rule.text}`];

	return [];
}

/** Lines set off by a blank line before them; nothing when there are none. */
function paragraph(lines: string[]): string[] {
	return lines.length > 0 ? ['', ...lines] : [];
}

function fixLines(bug: BugView): string[] {
	if (!bug.fix) return [];
	if ('diff' in bug.fix) return ['A fix the review checked:', '```diff', bug.fix.diff, '```'];

	return [`Suggested fix: ${bug.fix.text}`];
}

/**
 * The text to hand a coding agent so it fixes one finding: what is wrong and
 * where, the evidence, the suggested fix, and the bar to clear before pushing.
 */
export function fixPrompt(bug: BugView, pull: Pick<PullRequest, 'number' | 'title' | 'headRef'> | null): string {
	const head = pull
		? `Fix this finding from the review of PR #${pull.number} "${pull.title}" (branch \`${pull.headRef}\`).`
		: 'Fix this finding from a code review.';

	return [
		head,
		'',
		`[${bug.severity}] ${location(bug)}: ${bug.title}`,
		'',
		bug.explanation,
		...paragraph(evidenceLines(bug)),
		...paragraph(fixLines(bug)),
		'',
		'Add a test that fails without the fix where one is practical, keep the rest of the change as it is, and push to the same branch.'
	].join('\n');
}
