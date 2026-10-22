import { MAX_FINDING_MESSAGE_CHARS, type DiscussFinding } from '@recoder/shared';

import { where } from '../review/labels';
import type { Selection } from '../review/review-store';
import type { Decision, Receipt, Surface } from '../review/surface';

/** What a question is about: a decision (a finding or an open question) or something checked. */
export type AskItem =
	{ key: string; kind: 'decision'; decision: Decision } | { key: string; kind: 'receipt'; receipt: Receipt };

/** What a suggestion asks, so the sample can answer it. */
export type SuggestionIntent = 'why' | 'fix' | 'doubt' | 'open' | 'check' | 'impact' | 'how' | 'test';

export interface Suggestion {
	intent: SuggestionIntent;
	text: string;
}

/** The reviewer role that answers when the finding does not name one. */
const DEFAULT_AGENT = 'reviewer';

const FINDING_SUGGESTIONS: Suggestion[] = [
	{ intent: 'why', text: 'Why is this a problem?' },
	{ intent: 'fix', text: 'How would you fix it?' },
	{ intent: 'doubt', text: 'Could this be a false positive?' }
];

const QUESTION_SUGGESTIONS: Suggestion[] = [
	{ intent: 'open', text: 'Why is this still open?' },
	{ intent: 'check', text: 'How can I check it myself?' },
	{ intent: 'impact', text: 'What happens if it’s true?' }
];

const RECEIPT_SUGGESTIONS: Suggestion[] = [
	{ intent: 'how', text: 'How was this checked?' },
	{ intent: 'test', text: 'Does a test cover this?' }
];

/** The decision or receipt the reading pane shows, as something to ask about; null for the overview and files. */
export function askItemOf(surface: Surface | null, selection: Selection): AskItem | null {
	if (!surface) return null;

	if (selection.kind === 'decision') {
		const decision = surface.decisions.find((candidate) => candidate.id === selection.id);

		return decision ? { key: `decision:${decision.id}`, kind: 'decision', decision } : null;
	}

	if (selection.kind === 'receipt') {
		const receipt = surface.receipts.find((candidate) => candidate.id === selection.id);

		return receipt ? { key: `receipt:${receipt.id}`, kind: 'receipt', receipt } : null;
	}

	return null;
}

/** The item's heading: a finding's title, or the question a reviewer asked. */
export function askTitle(item: AskItem): string {
	return item.kind === 'decision' ? item.decision.title : item.receipt.question;
}

/** `middleware.ts:15`: where the item points, file name only. */
export function askWhere(item: AskItem): string {
	if (item.kind === 'decision') return where(item.decision.file, item.decision.line, item.decision.endLine, true);

	return where(item.receipt.file, item.receipt.line, null, true);
}

/** The questions offered while the item's thread is empty. */
export function suggestionsFor(item: AskItem): Suggestion[] {
	if (item.kind === 'receipt') return RECEIPT_SUGGESTIONS;

	return item.decision.kind === 'question' ? QUESTION_SUGGESTIONS : FINDING_SUGGESTIONS;
}

/** The reviewer role that raised the item, which answers for it. */
export function askAgent(item: AskItem): string {
	return (item.kind === 'decision' && item.decision.finding?.agent) || DEFAULT_AGENT;
}

/** The item in the shape the discuss endpoint reads. Receipts and open questions borrow a finding's fields. */
export function discussFinding(item: AskItem): DiscussFinding {
	const agent = askAgent(item);

	if (item.kind === 'receipt') {
		const { receipt } = item;
		const line = receipt.line ?? 1;

		return {
			file: receipt.file,
			line,
			endLine: line,
			severity: 'checked',
			message: `Checked and found sound: ${receipt.question}\n\n${receipt.reason}`.slice(0, MAX_FINDING_MESSAGE_CHARS),
			agent
		};
	}

	const { decision } = item;
	const line = decision.line ?? 1;

	return {
		file: decision.file,
		line,
		endLine: Math.max(decision.endLine ?? line, line),
		severity: decision.finding?.severity ?? 'question',
		message: `${decision.title}\n\n${decision.body}`.slice(0, MAX_FINDING_MESSAGE_CHARS),
		agent
	};
}
