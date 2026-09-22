/** Pull a JSON value out of model output (tolerates fences and surrounding prose). */
export function extractJsonValue(output: string): unknown {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(output);
	const candidate = (fenced ? fenced[1] : output).trim();
	try {
		return JSON.parse(candidate);
	} catch {
		// Models often wrap JSON in prose.
	}
	const objStart = candidate.indexOf('{');
	const arrStart = candidate.indexOf('[');
	if (objStart === -1 && arrStart === -1) throw new Error('no JSON in model output');
	if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
		const end = candidate.lastIndexOf(']');
		if (end > arrStart) return JSON.parse(candidate.slice(arrStart, end + 1));
	}
	if (objStart !== -1) {
		const end = candidate.lastIndexOf('}');
		if (end > objStart) return JSON.parse(candidate.slice(objStart, end + 1));
	}
	throw new Error('no JSON in model output');
}

function unwrapFindings(parsed: unknown): unknown {
	if (Array.isArray(parsed)) return parsed;
	if (parsed && typeof parsed === 'object') {
		const obj = parsed as Record<string, unknown>;
		for (const key of ['findings', 'items', 'results', 'issues']) {
			if (Array.isArray(obj[key])) return obj[key];
		}
		if (typeof obj.file === 'string') return [obj];
	}
	throw new Error('no JSON array in model output');
}

/** Pull a findings array out of model output (tolerates fences/prose/object wrappers). */
export function extractFindingsJson(output: string): unknown {
	return unwrapFindings(extractJsonValue(output));
}
