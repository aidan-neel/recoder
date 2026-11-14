import type { ComposerCommand } from '@recoder/ui';

/**
 * Asks the orchestrator for a new run. A draft session starts its review on
 * these words without a model deciding; after a finished or failed review the
 * orchestrator starts another run with the conversation as its brief. A run
 * already under way takes no second one, so the command is left out then.
 */
const REVIEW_AGAIN: ComposerCommand = {
	name: 'review',
	description: 'Review it again, from this chat',
	prompt: 'Review this pull request again.'
};

/** Questions about the whole pull request that the orchestrator answers from the diff and the findings. */
const PULL_QUESTIONS: ComposerCommand[] = [
	{
		name: 'summary',
		description: 'What it changes and why',
		prompt: 'Summarize what this pull request changes and why.'
	},
	{ name: 'risks', description: 'What could break when it merges', prompt: 'What could break when this merges?' },
	{ name: 'tests', description: 'Which tests it is missing', prompt: 'Which tests is this pull request missing?' },
	{ name: 'order', description: 'What to read first', prompt: 'In what order should I read the changed files?' }
];

/** The commands of the conversation about the whole pull request; `canReview` is false while a run is under way. */
export function pullCommands(canReview: boolean): ComposerCommand[] {
	return canReview ? [REVIEW_AGAIN, ...PULL_QUESTIONS] : PULL_QUESTIONS;
}

/** Questions about one finding, for the reviewer that raised it. */
export const BUG_COMMANDS: ComposerCommand[] = [
	{ name: 'why', description: 'Why this is a problem', prompt: 'Why is this a problem?' },
	{ name: 'fix', description: 'How to fix it', prompt: 'How would you fix it?' },
	{ name: 'proof', description: 'What shows it is real', prompt: 'What shows this is real and not a false positive?' }
];
