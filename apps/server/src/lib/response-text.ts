/** Decode the first JSON string field while it is still arriving. Never expose control JSON. */
export function streamedMessage(json: string): string {
	const start = /^\s*(?:```(?:json)?\s*)?\{\s*"message"\s*:\s*"/.exec(json);
	if (!start) return '';
	let text = '';
	for (let i = start[0].length; i < json.length; i++) {
		const char = json[i];
		if (char === '"') break;
		if (char !== '\\') { text += char; continue; }
		const escape = json[++i];
		if (!escape) break;
		if (escape === 'u') {
			const hex = json.slice(i + 1, i + 5);
			if (!/^[\da-f]{4}$/i.test(hex)) break;
			text += String.fromCharCode(parseInt(hex, 16));
			i += 4;
		} else {
			const decoded: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
			if (!(escape in decoded)) break;
			text += decoded[escape];
		}
	}
	return text;
}
