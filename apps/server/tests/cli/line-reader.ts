/** Reads a child's output one line at a time; a stream that ends before a whole line fails with what it had. */
export function lineReader(stream: ReadableStream<Uint8Array<ArrayBuffer>>): () => Promise<string> {
	const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
	let pending = '';

	return async () => {
		while (!pending.includes('\n')) {
			const chunk = await reader.read();

			if (chunk.done) throw new Error(`the output ended before a whole line; got "${pending}"`);

			pending += chunk.value;
		}

		const end = pending.indexOf('\n');
		const line = pending.slice(0, end);

		pending = pending.slice(end + 1);

		return line;
	};
}
