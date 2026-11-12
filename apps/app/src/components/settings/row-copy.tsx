import { SUBAGENT_CAPS, type SubagentCap } from '@recoder/shared';
import { Monitor, Moon, Sun } from 'lucide-react';

import type { ModelRole } from '@/lib/settings/model-options';

/**
 * Review harness → Reviewers: how many subagents each reviewer may run, and
 * what each cap allows. Like every row's words in this file, the section
 * draws its row from them and the skeleton draws its placeholder row to the
 * same words, hidden, so the placeholder wraps where the loaded row will.
 */
export const SUBAGENTS = {
	name: 'Subagents',
	options: SUBAGENT_CAPS.map((cap) => ({ value: String(cap), label: cap ? `Up to ${cap}` : 'Off' })),
	text: {
		0: 'Reviewers work alone, using the fewest tokens',
		2: 'Reviewers can run up to 2 subagents per review',
		4: 'Reviewers can run up to 4 subagents, using the most tokens'
	} satisfies Record<SubagentCap, string>
};

/** Review harness → Reviewers: whether reviews report low-severity findings. */
export const LOW_SEVERITY = {
	name: 'Low severity findings',
	on: 'Reviews report every severity',
	off: 'Reviews report medium and above'
};

/** Appearance → Display: the theme, which lives in this browser. */
export const THEME = {
	name: 'Theme',
	description: 'System follows your device',
	options: [
		{ value: 'system', label: 'System', icon: <Monitor aria-hidden /> },
		{ value: 'light', label: 'Light', icon: <Sun aria-hidden /> },
		{ value: 'dark', label: 'Dark', icon: <Moon aria-hidden /> }
	]
};

/** Agent → Models: what each review model does, under its name. */
export const MODEL_TEXT: Record<ModelRole, string> = {
	orchestrator: 'Runs the reviewers, the summary and Orchestrator in chat',
	specialist: 'Answers the questions reviewers hand off and checks each finding'
};
