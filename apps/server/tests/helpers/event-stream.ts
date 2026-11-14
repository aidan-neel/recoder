/**
 * Reads a server-sent event stream frame by frame until `pick` returns a
 * value for one of its events, then stops reading and returns it. Each
 * frame's data is taken as an `Event` as is: the server under test wrote
 * it. Throws when the stream ends first; `awaited` says what was awaited.
 */
export async function readEventsUntil<Event, Result>(
	body: ReadableStream<Uint8Array>,
	pick: (event: Event) => Result | undefined,
	awaited: string
): Promise<Result> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	try {
		for (;;) {
			const { value, done } = await reader.read();

			if (done) throw new Error(`The event stream ended before ${awaited}.`);
			buffer += decoder.decode(value, { stream: true });

			const frames = buffer.split('\n\n');

			buffer = frames.pop() ?? '';

			for (const frame of frames) {
				const result = pick(JSON.parse(frame.slice(frame.indexOf('data:') + 5)) as Event);

				if (result !== undefined) return result;
			}
		}
	} finally {
		await reader.cancel();
	}
}
