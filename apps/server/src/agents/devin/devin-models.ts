import type { ModelEntry } from '@recoder/shared';

/** Prefix of a Devin model's id in the Model select, so routing knows the CLI runs it. */
export const DEVIN_MODEL_PREFIX = 'devin:';

/** What `devin models list` leaves out for a model, and the window most of them have. */
const DEFAULT_CONTEXT_WINDOW = 200_000;

const LINE = /^\s{2}([a-z0-9][\w.-]*)\s{2,}(.+?)\s{2,}\[(\d+)([KM])? context\b/i;

/** `262K` → 262000, `1M` → 1000000, a bare count as it is. */
function contextWindow(count: string, unit: string | undefined): number {
	const size = Number(count);

	if (!Number.isFinite(size) || size <= 0) return DEFAULT_CONTEXT_WINDOW;

	if (unit?.toUpperCase() === 'K') return size * 1000;

	return unit?.toUpperCase() === 'M' ? size * 1_000_000 : size;
}

/**
 * The models in the output of `devin models list`. Each indented line is one runnable model: its id, a label and
 * a bracket that starts with the context window. Devin names the effort in the id (`swe-2-high`), so a model has
 * no separate effort levels. Family headings, alias lines and the `adaptive` router, which has no context
 * window, are skipped.
 */
export function parseDevinModels(output: string): ModelEntry[] {
	const entries: ModelEntry[] = [];

	for (const line of output.split('\n')) {
		const match = LINE.exec(line);

		if (!match) continue;

		const [, model, label, count, unit] = match;

		entries.push({
			id: `${DEVIN_MODEL_PREFIX}${model}`,
			provider: 'devin',
			label: label.trim(),
			model,
			baseUrl: null,
			apiKeyPreview: null,
			contextWindow: contextWindow(count, unit)
		});
	}

	return entries;
}
