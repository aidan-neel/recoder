import type { FailureAction } from '@recoder/shared';

import { ApiError, failureText } from '../api/http';

/** Why a question or message got no answer, and the way out the server offered. */
export interface ChatFailure {
	message: string;
	action?: FailureAction;
}

/**
 * The server's terse reasons a chat or discuss call can meet, in the reader's
 * words, and the one place they are mapped. Each names no next step, since
 * the failed reply has a Try again button. A map, so no message can match an
 * object's own members.
 */
const PLAIN = new Map([['no diff yet', 'The diff isn’t ready yet.']]);

/**
 * An error from a chat or discuss call, as the transcript shows it: a known
 * terse reason in the reader's words, and any other server or CLI text
 * through the same cleaner as every other failure.
 */
export function chatFailure(error: unknown): ChatFailure {
	const message = failureText(error, 'The reviewer didn’t respond.');

	if (!(error instanceof ApiError)) return { message };

	return {
		message: PLAIN.get(error.message) ?? message,
		action: error.action ?? (error.usageLimit ? 'settings' : undefined)
	};
}
