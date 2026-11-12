import { repoPaths, type RepoInventory } from '../repo-inventory/repo-inventory.js';
import { languageFor } from './languages.js';
import { parseRepoFiles } from './parsed-files.js';
import { isTestPath } from './test-files.js';
import type { RepoMetricsBaseline, SymbolMetrics } from './types.js';

/** Files sampled per language; evenly spaced through the sorted file list, so every run picks the same ones. */
const SAMPLE_FILES = 120;

/** Kinds whose shape the baseline measures; types and variables have no body worth comparing. */
const MEASURED = new Set(['function', 'method', 'component']);

/** Whether a symbol's shape is compared to the baseline; a Svelte file's component is the whole file, not a function. */
export function isMeasured(symbol: { kind: string; language: string }): boolean {
	return MEASURED.has(symbol.kind) && !(symbol.kind === 'component' && symbol.language === 'svelte');
}

/** The value at the 95th percentile, by nearest rank. */
function p95(values: number[]): number {
	if (!values.length) return 0;

	const sorted = [...values].sort((a, b) => a - b);

	return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

/** Up to `count` items spread evenly through `items`, always the same ones for the same list. */
function evenSample<T>(items: T[], count: number): T[] {
	if (items.length <= count) return items;

	return Array.from({ length: count }, (_, index) => items[Math.floor((index * items.length) / count)]);
}

async function baselineFor(
	root: string,
	repo: RepoInventory,
	language: string,
	signal: AbortSignal
): Promise<RepoMetricsBaseline | null> {
	const files = evenSample(
		repoPaths(repo).filter((path) => languageFor(path) === language && !isTestPath(path)),
		SAMPLE_FILES
	);

	const parsed = await parseRepoFiles(root, repo, files, signal);

	const metrics: SymbolMetrics[] = files.flatMap((path) =>
		(parsed.get(path) ?? []).filter(isMeasured).map((symbol) => symbol.metrics)
	);

	if (!metrics.length) return null;

	return {
		language,
		sampled: metrics.length,
		p95: {
			lines: p95(metrics.map((entry) => entry.lines)),
			maxDepth: p95(metrics.map((entry) => entry.maxDepth)),
			params: p95(metrics.map((entry) => entry.params))
		}
	};
}

/** Each language's p95 symbol shape over a deterministic sample of the repo's non-test files. */
export async function repoBaselines(
	root: string,
	repo: RepoInventory,
	languages: string[],
	signal: AbortSignal
): Promise<RepoMetricsBaseline[]> {
	const baselines: RepoMetricsBaseline[] = [];

	for (const language of [...new Set(languages)].sort()) {
		if (signal.aborted) break;

		const baseline = await baselineFor(root, repo, language, signal);

		if (baseline) baselines.push(baseline);
	}

	return baselines;
}
