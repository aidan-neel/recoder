import type { ModelEntry } from '@recoder/shared';

/** Prefix of a Grok Build model's id in the Model select, so routing knows the CLI runs it. */
const GROK_MODEL_PREFIX = 'grok:';

/** Heading of the model section of `grok models` output. */
const AVAILABLE_MODELS = /available models/i;

/** A list row of `grok models`: `  * grok-4.7 (default)` or `  - grok-4.6`. */
const MODEL_ROW = /^\s*[*-]\s+([A-Za-z0-9][\w.-]*)/;

/**
 * The runnable models of `grok models` output: the rows under "Available models", first token of each row being
 * the model id (`(default)` and other annotations are ignored). Rows of any later section do not count: the
 * section ends at the first non-blank line that is not indented.
 */
export function parseGrokModels(output: string): ModelEntry[] {
	const entries: ModelEntry[] = [];
	let listed = false;

	for (const line of output.split('\n')) {
		if (!listed) {
			if (AVAILABLE_MODELS.test(line)) listed = true;

			continue;
		}

		if (line.trim() === '') continue;
		if (!/^\s/.test(line)) break;

		const row = MODEL_ROW.exec(line);

		if (row) {
			const model = row[1];

			entries.push({
				id: `${GROK_MODEL_PREFIX}${model}`,
				provider: 'grok',
				label: model,
				model,
				baseUrl: null,
				apiKeySet: false
			});
		}
	}

	return entries;
}
