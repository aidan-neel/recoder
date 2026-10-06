import type { ChangeIntent, IntentClaim, PrRef } from './types.js';

const SECTIONS: {
	key: keyof Omit<ChangeIntent, 'summary' | 'stack' | 'observedChanges' | 'openQuestions' | 'units' | 'complete'>;
	heading: string;
}[] = [
	{ key: 'goals', heading: 'Goals' },
	{ key: 'acceptanceCriteria', heading: 'Acceptance criteria (check the code meets each)' },
	{ key: 'statedConstraints', heading: 'Stated constraints' },
	{ key: 'nonGoals', heading: 'Non-goals (out of scope; not a finding when the code leaves these undone)' },
	{ key: 'priorDecisions', heading: 'Prior decisions (why the code is shaped this way)' }
];

function claimLine(claim: IntentClaim): string {
	return `${claim.id}: ${claim.text} (${claim.source})`;
}

function prLabel(pr: PrRef): string {
	return `#${pr.number} "${pr.title}"`;
}

/** The stack as one line, or '' when the PR stands alone. */
function stackLine(stack: ChangeIntent['stack']): string {
	const parts = [
		stack.parent ? `stacked on ${prLabel(stack.parent)} (head ${stack.parent.headRef})` : '',
		stack.children.length ? `stacked under it: ${stack.children.map(prLabel).join(', ')}` : ''
	].filter(Boolean);

	return parts.length ? `Stack: ${parts.join('; ')}` : '';
}

/**
 * What the change is meant to do, as a compact block for lens reviewers and
 * the verifier. The brief's reading of the code is left out: it would lead
 * a verifier, and reviewers get their unit's part from `briefBlock`. Claims
 * keep their ids so a finding or verdict can cite them. Empty when there is
 * no intent or it says nothing, as when every unit and the sources failed.
 */
export function intentBlock(intent: ChangeIntent | null): string {
	if (!intent) return '';

	const lines: string[] = intent.summary ? [`Summary: ${intent.summary}`] : [];

	for (const { key, heading } of SECTIONS) {
		if (intent[key].length) lines.push(`${heading}:`, ...intent[key].map(claimLine));
	}

	const stack = stackLine(intent.stack);

	if (stack) lines.push(stack);
	if (!lines.length) return '';

	return ['Change intent (distilled from the PR, its issues and discussion; cite claim ids):', ...lines].join('\n');
}
