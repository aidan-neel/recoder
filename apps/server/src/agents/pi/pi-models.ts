import type { ModelEntry } from '@recoder/shared';
import { PI_DEFAULT_EFFORT, PI_EFFORTS } from './pi-process';

/** Prefix of a Pi model's id in the Model select, so routing knows the CLI runs it. */
const PI_MODEL_PREFIX = 'pi:';

/**
 * A row of `pi --list-models`: provider, model, context window, output cap, whether it thinks, whether it takes
 * images, in columns two or more spaces apart. Pi writes sizes as `128K`, `16.4K` or `1M`.
 */
const ROW = /^(\S+) {2,}(\S+) {2,}(\d+(?:\.\d+)?)([KM]?) {2,}\S+ {2,}(yes|no)\b/;

/** `128K` → 128000, `1M` → 1000000, a bare count as it is. */
function tokenCount(count: string, unit: string): number {
	const size = Number(count);

	if (unit === 'K') return Math.round(size * 1000);

	return unit === 'M' ? Math.round(size * 1_000_000) : size;
}

/**
 * The models in the output of `pi --list-models`: the models of every provider Pi has a sign-in or a key for. The
 * header row and Pi's `No models available` message match no row. A model that thinks takes Pi's thinking levels.
 */
export function parsePiModels(output: string): ModelEntry[] {
	const entries: ModelEntry[] = [];

	for (const line of output.split('\n')) {
		const match = ROW.exec(line);

		if (!match || match[1] === 'provider') continue;

		const [, provider, model, count, unit, thinks] = match;

		entries.push({
			id: `${PI_MODEL_PREFIX}${provider}/${model}`,
			provider: 'pi',
			label: `${model} (${provider})`,
			model: `${provider}/${model}`,
			baseUrl: null,
			apiKeySet: false,
			contextWindow: tokenCount(count, unit),
			...(thinks === 'yes' ? { efforts: PI_EFFORTS, defaultEffort: PI_DEFAULT_EFFORT } : {})
		});
	}

	return entries;
}
