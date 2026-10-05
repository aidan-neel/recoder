/**
 * One agent's run of model calls. A transport that keeps state between calls
 * (an OpenCode session, so the provider's prompt cache is reused turn after
 * turn) ties it to this handle and frees it when the conversation closes.
 */
export class ChatConversation {
	private readonly closers: (() => Promise<void>)[] = [];

	/** Register cleanup to run when the conversation closes. */
	onClose(closer: () => Promise<void>): void {
		this.closers.push(closer);
	}

	/** Free what transports kept for this conversation. Cleanup is best effort and never throws. */
	async close(): Promise<void> {
		await Promise.all(this.closers.splice(0).map((closer) => closer().catch(() => {})));
	}
}
