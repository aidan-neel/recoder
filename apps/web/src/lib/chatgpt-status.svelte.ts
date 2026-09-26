import { serverApi } from '$lib/server-api';

/** Whether ChatGPT is signed in, so sign-in prompts can clear once it is. */
class ChatGptStatus {
	/** Null until checked. */
	signedIn = $state<boolean | null>(null);
	private pending: Promise<void> | null = null;

	check(): Promise<void> {
		this.pending ??= serverApi.getCodexStatus()
			.then((status) => { this.signedIn = status.authenticated; })
			.catch(() => {})
			.finally(() => { this.pending = null; });
		return this.pending;
	}
}

export const chatGptStatus = new ChatGptStatus();
