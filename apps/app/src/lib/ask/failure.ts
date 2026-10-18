import type { FailureAction } from '@recoder/shared';

import { ApiError, failureText } from '../api/http';

/** Why a question or message got no answer, and the way out the server offered. */
export interface ChatFailure {
	message: string;
	action?: FailureAction;
}

/** The server's terse reasons, in the reader's words. */
const PLAIN: Record<string, string> = {
	'no diff yet': 'The diff isn’t ready yet. Try again in a moment.'
};

/** An error from a chat or discuss call, as the transcript shows it. */
export function chatFailure(error: unknown): ChatFailure {
	if (error instanceof ApiError) {
		return {
			message: PLAIN[error.message] ?? error.message,
			action: error.action ?? (error.usageLimit ? 'settings' : undefined)
		};
	}

	return { message: failureText(error, 'The reviewer didn’t respond.') };
}
