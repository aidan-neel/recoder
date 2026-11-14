import type { ModelEntry } from '@recoder/shared';

/** Prefix of a Cursor model's id in the Model select, so routing knows the CLI runs it. */
const CURSOR_MODEL_PREFIX = 'cursor:';

/** One `cursor-agent models` line: `model-id - Display Name`, with `(current)`/`(default)` markers to strip. */
const LINE = /^(\S+)\s+-\s+(.+?)\s*$/;

/** A bare model id on its own line: letters, digits and the separators model names use, with at least one separator or digit. */
const BARE_ID = /^[A-Za-z0-9][\w./-]*$/;

/** Headers and hints the listing prints around the models, which are not models themselves. */
const NOISE = /^(?:available models|tip\b|models:?$)/i;

/**
 * The models in the output of `cursor-agent models`. Each `id - Label` line is one runnable model; section
 * headers, tips and blank lines are skipped, and a bare id line counts only when it looks like a model name.
 * Cursor reports no context window or effort levels per model, so neither is set.
 */
export function parseCursorModels(output: string): ModelEntry[] {
	const entries: ModelEntry[] = [];
	const seen = new Set<string>();

	for (const raw of output.split('\n')) {
		const line = raw.trim();

		if (!line || NOISE.test(line)) continue;

		const match = LINE.exec(line);
		const model = match?.[1] ?? (BARE_ID.test(line) && /[\d./-]/.test(line) ? line : undefined);

		if (!model || seen.has(model)) continue;

		seen.add(model);

		const label = (match?.[2] ?? model).replace(/\s*\((?:current|default)\)\s*$/, '').trim() || model;

		entries.push({
			id: `${CURSOR_MODEL_PREFIX}${model}`,
			provider: 'cursor',
			label,
			model,
			baseUrl: null,
			apiKeySet: false
		});
	}

	return entries;
}
