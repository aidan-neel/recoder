import { codex } from '../../agents/codex/codex.js';
import { configForOrchestrator, configForSubagent } from '../../models/models.js';
import { notReadyError } from '../exit.js';

/** The one step that signs in; the sign-in is part of Recoder's settings, not of a command. */
export const CHATGPT_SIGN_IN = 'Sign in to ChatGPT in Recoder\u2019s settings (Settings \u2192 Agent).';

/**
 * Stops the run before it fetches or checks out anything when a model it uses needs the ChatGPT sign-in and there is
 * none, as the server's review does. The saved credentials are read; no request is made.
 */
export async function assertChatGptSignedIn(): Promise<void> {
	const usesChatGpt = [configForOrchestrator(), configForSubagent()].some((config) => config.provider === 'codex');

	if (usesChatGpt && !(await codex.signedIn())) throw notReadyError(`ChatGPT is not signed in. ${CHATGPT_SIGN_IN}`);
}
