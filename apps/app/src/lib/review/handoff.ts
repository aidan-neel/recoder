import type { Decision } from './surface';

export interface HandoffItem {
	decision: Decision;
	note: string;
}

const TONE_LABEL = { high: 'High', medium: 'Medium', low: 'Low', question: 'Question' } as const;

function location(decision: Decision): string {
	if (decision.line === null) return decision.file;
	if (decision.endLine !== null && decision.endLine !== decision.line)
		return `${decision.file}:${decision.line}-${decision.endLine}`;

	return `${decision.file}:${decision.line}`;
}

function item(index: number, { decision, note }: HandoffItem): string {
	const lines = [
		`${index + 1}. [${TONE_LABEL[decision.tone]}] ${location(decision)} — ${decision.title}`,
		`   ${decision.body}`
	];

	if (decision.evidence?.command) lines.push(`   Reproduce: \`${decision.evidence.command}\``);
	if (decision.suggestion) lines.push(`   Suggested fix: ${decision.suggestion}`);
	if (note.trim()) lines.push(`   Reviewer note: ${note.trim()}`);

	return lines.join('\n');
}

/**
 * The prompt a person hands back to the coding agent that wrote the PR: every
 * item they sent back, with where it is, how to reproduce it and their note,
 * plus the bar the agent has to clear before pushing.
 */
export function handoffPrompt(
	pr: { number: number; title: string; branch: string | null },
	items: HandoffItem[]
): string {
	const head = `Review feedback on PR #${pr.number} "${pr.title}"${pr.branch ? ` (branch \`${pr.branch}\`)` : ''}.`;

	const ask =
		'Address each point below, add a test that fails without your fix where one is practical, and push to the same branch.';

	return [
		head,
		ask,
		'',
		...items.map((entry, index) => item(index, entry)),
		'',
		'Keep the rest of the change as it is.'
	].join('\n');
}
