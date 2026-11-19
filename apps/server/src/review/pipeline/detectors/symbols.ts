import type { ChangeModel, ChangedSymbol, RepoMetricsBaseline, SymbolMetrics } from '../change-model/types.js';
import type { ReviewInventory } from '../inventory.js';
import type { AddedLines } from './changed-lines.js';
import type { DetectorResult } from './types.js';

/**
 * A symbol counts as complex only past both the repo's own p95 and these
 * floors, so a repo of tiny functions doesn't flag a normal one. Line count
 * alone is never the finding: a symbol past `lines` but within the depth and
 * parameter floors is left alone, and a symbol under `lines` is never
 * reported for size however the repo's p95 reads.
 */
const COMPLEXITY_FLOORS: SymbolMetrics = { lines: 150, maxDepth: 4, params: 5 };

/** A modified symbol is judged only when the change wrote at least this share of its lines. */
const MIN_ADDED_SHARE = 0.25;

const METRIC_NAMES: Record<keyof SymbolMetrics, string> = {
	lines: 'lines',
	maxDepth: 'levels of nesting',
	params: 'parameters'
};

/** Framework entry files whose exports the framework calls by name (SvelteKit's `+page.ts`, `+server.ts`…). */
function frameworkEntry(file: string): boolean {
	return (file.split('/').pop() ?? '').startsWith('+');
}

/**
 * Exported symbols the change adds that nothing outside their own file names,
 * tests included: an export no one imports. A test file that sits beside the
 * module by path convention doesn't count unless it names the symbol. A
 * symbol whose name was not fully searched for is never reported.
 */
export function deadCodeResults(model: ChangeModel | null, inventory: ReviewInventory): DetectorResult[] {
	const sources = new Set(inventory.files.filter((file) => file.classification === 'source').map((file) => file.path));

	return (model?.symbols ?? [])
		.filter(
			(symbol) =>
				symbol.change === 'added' &&
				symbol.exported &&
				symbol.kind !== 'module' &&
				symbol.name !== 'default' &&
				sources.has(symbol.file) &&
				!frameworkEntry(symbol.file) &&
				!symbol.usageUnknown &&
				symbol.references.every((reference) => reference.file === symbol.file)
		)
		.map((symbol) => ({
			detector: 'dead-code',
			category: 'dead-code',
			title: `\`${symbol.name}\` is exported but never used`,
			body: `The change adds and exports \`${symbol.qualifiedName}\`, but no other file or test refers to it. Remove it, or stop exporting it if only this file needs it.`,
			file: symbol.file,
			line: symbol.startLine,
			endLine: symbol.endLine,
			symbol: symbol.qualifiedName,
			evidence: `No reference to ${symbol.name} outside ${symbol.file} at the PR head, and no test names it.`
		}));
}

/** Lines of the symbol the diff adds. */
function addedWithin(symbol: ChangedSymbol, added: AddedLines): number {
	let count = 0;

	for (const line of added.get(symbol.file)?.keys() ?? [])
		if (line >= symbol.startLine && line <= symbol.endLine) count++;

	return count;
}

/** The metrics past both the floor and the repo's p95, as `[name, value, limit]`. */
function exceeded(metrics: SymbolMetrics, baseline: RepoMetricsBaseline): [keyof SymbolMetrics, number, number][] {
	return (Object.keys(COMPLEXITY_FLOORS) as (keyof SymbolMetrics)[])
		.map((key): [keyof SymbolMetrics, number, number] => [
			key,
			metrics[key],
			Math.max(COMPLEXITY_FLOORS[key], baseline.p95[key])
		])
		.filter(([, value, limit]) => value > limit);
}

/** The metrics a finding needs a concrete problem for: nesting and parameters, never line count. */
function concreteOver(over: [keyof SymbolMetrics, number, number][]): [keyof SymbolMetrics, number, number][] {
	return over.filter(([key]) => key !== 'lines');
}

function complexityResult(
	symbol: ChangedSymbol,
	over: [keyof SymbolMetrics, number, number][],
	size: [keyof SymbolMetrics, number, number][]
): DetectorResult {
	const parts = over.map(([key, value]) => `${value} ${METRIC_NAMES[key]}`);
	const limits = over.map(([key, , limit]) => `${METRIC_NAMES[key]} ${limit}`);
	const lines = size.find(([key]) => key === 'lines');
	const alsoSize = lines ? ` It also runs ${lines[1]} lines, more than 95% of the repo's declarations.` : '';

	return {
		detector: 'complexity',
		category: 'complexity',
		title: `\`${symbol.name}\` is harder to follow than almost all code in this repo`,
		body: `\`${symbol.qualifiedName}\` has ${parts.join(', ')}, more than 95% of this repo's ${symbol.language} declarations.${alsoSize} Consider naming the steps or thinning the signature if the code is hard to work with; a large but straightforward function is fine as it is.`,
		file: symbol.file,
		line: symbol.startLine,
		endLine: symbol.endLine,
		symbol: symbol.qualifiedName,
		evidence: `${symbol.qualifiedName}: ${size.map(([key, value]) => `${key} ${value}`).join(', ')}; limit (max of repo p95 and floor): ${limits.join(', ')}.`,
		severity: 'info'
	};
}

/**
 * Changed symbols past both the repo's p95 and the absolute floors for their
 * language, where the metric past the limits is nesting depth or parameters.
 * Line count is supporting evidence, never the reason: a long but shallow
 * function with few parameters is not reported. A modified symbol counts only
 * when the change wrote a real share of it, so touching one line of an old
 * long function doesn't flag it.
 */
export function complexityResults(model: ChangeModel | null, added: AddedLines): DetectorResult[] {
	if (!model) return [];

	const baselines = new Map(model.baselines.map((baseline) => [baseline.language, baseline]));

	return model.symbols.flatMap((symbol) => {
		const baseline = baselines.get(symbol.language);

		if (!baseline || symbol.change === 'deleted') return [];
		if (symbol.change === 'modified' && addedWithin(symbol, added) < symbol.metrics.lines * MIN_ADDED_SHARE) return [];

		const over = exceeded(symbol.metrics, baseline);
		const concrete = concreteOver(over);

		return concrete.length ? [complexityResult(symbol, concrete, over)] : [];
	});
}
