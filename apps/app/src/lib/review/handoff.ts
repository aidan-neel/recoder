import { TONE_LABEL, where } from './labels';
import type { DecisionRecord } from './saved-decisions';
import type { Decision } from './surface';

interface HandoffItem {
	decision: Decision;
	note: string;
}

/** The pull request a handoff names. */
interface HandoffPull {
	number: number;
	title: string;
	branch: string | null;
}

/** Every decision the person sent back, in rail order, with its note. */
export function sentItems(decisions: Decision[], records: Record<string, DecisionRecord>): HandoffItem[] {
	return decisions.flatMap((decision) => {
		const record = records[decision.id];

		return record?.state === 'sent' ? [{ decision, note: record.note }] : [];
	});
}

/**
 * One numbered item. The repro command is offered only when it reproduced the
 * problem; a command that never ran proves nothing to the agent.
 */
function item(index: number, { decision, note }: HandoffItem): string {
	const lines = [
		`${index + 1}. [${TONE_LABEL[decision.tone]}] ${where(decision.file, decision.line, decision.endLine)} — ${decision.title}`,
		`   ${decision.body}`
	];

	if (decision.proof === 'reproduced' && decision.evidence?.command)
		lines.push(`   Reproduce: \`${decision.evidence.command}\``);
	if (decision.suggestion) lines.push(`   Suggested fix: ${decision.suggestion}`);
	if (note.trim()) lines.push(`   Reviewer note: ${note.trim()}`);

	return lines.join('\n');
}

/**
 * The prompt a person hands back to the coding agent that wrote the PR: every
 * item they sent back, with where it is, how to reproduce it and their note,
 * plus the bar the agent has to clear before pushing. Items are separated by
 * a blank line so each reads as its own point.
 */
export function handoffPrompt(pr: HandoffPull, items: HandoffItem[]): string {
	const head = `Review feedback on PR #${pr.number} "${pr.title}"${pr.branch ? ` (branch \`${pr.branch}\`)` : ''}.`;

	const ask =
		'Address each point below, add a test that fails without your fix where one is practical, and push to the same branch.';

	return [
		head,
		ask,
		'',
		items.map((entry, index) => item(index, entry)).join('\n\n'),
		'',
		'Keep the rest of the change as it is.'
	].join('\n');
}
