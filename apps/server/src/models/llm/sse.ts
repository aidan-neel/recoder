/** Yield each SSE `data:` payload, racing every read against `aborted` so a wedged socket can't hang it. */
export async function* sseData(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	signal: AbortSignal,
	aborted: Promise<never>,
	onRead: () => void
): AsyncGenerator<string> {
	const decoder = new TextDecoder();
	let buffer = '';

	for (;;) {
		signal.throwIfAborted();

		const { done, value } = await Promise.race([reader.read(), aborted]);

		onRead();
		signal.throwIfAborted();
		buffer += done ? decoder.decode() + '\n' : decoder.decode(value, { stream: true });

		let idx: number;

		while ((idx = buffer.indexOf('\n')) >= 0) {
			const line = buffer.slice(0, idx).trim();

			buffer = buffer.slice(idx + 1);
			if (line.startsWith('data:')) yield line.slice(5).trim();
		}

		if (done) return;
	}
}
