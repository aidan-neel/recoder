/** One frame of a streamed model reply. */
type ReplyEvent<Done> = { type: 'token'; text: string } | ({ type: 'done' } & Done) | { type: 'error'; error: string };

/**
 * Runs a token stream (`token` frames, then one `done` or `error`), hands each
 * token to `onToken`, and resolves with the `done` frame. A stream that ends
 * without one rejects, so a dropped connection never reads as an empty reply.
 */
export async function streamReply<Done>(
	run: (onEvent: (event: unknown) => void) => Promise<void>,
	onToken: (text: string) => void
): Promise<Done> {
	let result: Done | null = null;
	let failure: string | null = null;

	await run((raw) => {
		const event = raw as ReplyEvent<Done>;

		if (event.type === 'token') onToken(event.text);
		else if (event.type === 'done') result = event;
		else if (event.type === 'error') failure = event.error;
	});

	if (failure !== null) throw new Error(failure);
	if (result === null) throw new Error('The model stopped before it finished.');

	return result;
}
