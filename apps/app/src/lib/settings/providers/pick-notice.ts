import type { AgentStatus } from '@recoder/shared';

import { OFFLINE_TEXT } from '../../api/http';
import { CHECK_FAILED } from './use-check-again';
import type { ProviderSource } from './use-provider-source';

/** What a notice in place of the provider list says and offers. */
export interface PickNoticeView {
	/** The lead line, set strong. */
	lead: string;
	/** The quieter rest of the sentence, when there is one. */
	rest: string | null;
	/** The install command to show, when the agent is missing. */
	command: string | null;
	/** What to do with the command: "Install it, then check again." */
	commandHint: string | null;
	/** The retry action's label; null when there is nothing to retry (no provider agent at all). */
	retryLabel: string | null;
}

/** The agent that connects providers is missing or broken: the command that fixes it, when there is one. */
function unreadyNotice(manager: AgentStatus | null): PickNoticeView {
	if (!manager) {
		return {
			lead: 'No agent connects providers.',
			rest: 'Check the review server.',
			command: null,
			commandHint: null,
			retryLabel: null
		};
	}

	if (!manager.installed) {
		return {
			lead: `${manager.name} isn’t installed.`,
			rest: null,
			command: manager.install,
			commandHint: 'Install it, then check again.',
			retryLabel: 'Check again'
		};
	}

	return {
		lead: `${manager.name} can’t run.`,
		rest: manager.error,
		command: null,
		commandHint: null,
		retryLabel: 'Check again'
	};
}

/**
 * Why the provider list is empty: the server is down, the agent check failed,
 * or the agent that connects providers isn't ready. `source` is the
 * non-loading, non-ready arm of `ProviderSource`.
 */
export function pickNotice(source: Exclude<ProviderSource, { state: 'loading' | 'ready' }>): PickNoticeView {
	if (source.state === 'offline') {
		return {
			lead: OFFLINE_TEXT,
			rest: 'Start it, then try again.',
			command: null,
			commandHint: null,
			retryLabel: 'Try again'
		};
	}

	if (source.state === 'error') {
		return {
			lead: `${CHECK_FAILED}.`,
			rest: source.message,
			command: null,
			commandHint: null,
			retryLabel: 'Check again'
		};
	}

	return unreadyNotice(source.manager);
}
