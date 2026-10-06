import type { ContextItem, ContextOmission } from '@recoder/shared';
import type { UnitScope } from '../units.js';
import { isMeasured } from './metrics.js';
import { innermost } from './owners.js';
import { omission, sourceItem, suppliedBy } from './supplied.js';
import type { ChangedSymbol, ChangeModel, RepoMetricsBaseline, SymbolReference } from './types.js';

const DEFAULT_MAX_CHARS = 6000;
/** Room kept for the "…N more" line, so the block never passes its cap. */
const TAIL_RESERVE = 60;
/** Longest call-site line, signature and previous signature shown for a symbol whose contract changed. */
const CALLER_LINE_CHARS = 110;
const CONTRACT_CHARS = 200;

/** `oldStart,oldCount:newStart,newCount` at the end of an inventory hunk id; the path before it may hold colons. */
const HUNK_ID = /:(\d+),(\d+):(\d+),(\d+)$/;

function innermostOf(symbols: ChangedSymbol[], line: number): ChangedSymbol | null {
	const index = innermost(symbols, line);

	return index < 0 ? null : symbols[index];
}

/** An old-side line moved to the new side past the hunks above it; a line inside a hunk keeps its offset, clamped. */
function oldToNew(model: ChangeModel, file: string, line: number): number {
	let shift = 0;

	for (const id of Object.keys(model.byHunk)) {
		const match = HUNK_ID.exec(id);

		if (!match || id.slice(0, match.index) !== file) continue;

		const [oldStart, oldCount, newStart, newCount] = match.slice(1).map(Number);

		if (oldCount > 0 && line >= oldStart && line < oldStart + oldCount) {
			return Math.max(1, Math.min(newStart + (line - oldStart), newStart + Math.max(0, newCount - 1)));
		}

		if (line >= (oldCount === 0 ? oldStart + 1 : oldStart + oldCount)) shift += newCount - oldCount;
	}

	return line + shift;
}

/**
 * The innermost changed symbol around a line: the smallest range wins, then
 * the later start. An old-side line matches a deleted symbol first, else the
 * head symbol where that line now sits.
 */
export function symbolAt(
	model: ChangeModel,
	file: string,
	line: number,
	side: 'old' | 'new' = 'new'
): ChangedSymbol | null {
	const inFile = model.symbols.filter((symbol) => symbol.file === file);
	const head = inFile.filter((symbol) => symbol.change !== 'deleted');

	if (side === 'new') return innermostOf(head, line);

	return (
		innermostOf(
			inFile.filter((symbol) => symbol.change === 'deleted'),
			line
		) ?? innermostOf(head, oldToNew(model, file, line))
	);
}

/** Symbols the scope's hunks touch; an empty hunk list means the whole file. In model order. */
function scopeSymbols(model: ChangeModel, scope: UnitScope): ChangedSymbol[] {
	const wanted = new Set<string>();

	for (const entry of scope) {
		if (!entry.hunkIds.length) {
			for (const symbol of model.symbols) if (symbol.file === entry.path) wanted.add(symbol.id);
			continue;
		}

		for (const id of entry.hunkIds) for (const symbolId of model.byHunk[id] ?? []) wanted.add(symbolId);
	}

	return model.symbols.filter((symbol) => wanted.has(symbol.id));
}

/** `31 lines (p95 48)`, flagged when the symbol is past its language's p95. */
function measure(value: number, unit: string, p95: number | undefined): string {
	if (p95 === undefined) return `${value} ${unit}`;

	return `${value} ${unit} (repo p95 ${p95}${value > p95 ? ', above' : ''})`;
}

function metricsLine(symbol: ChangedSymbol, baseline: RepoMetricsBaseline | undefined): string {
	const { lines, maxDepth, params } = symbol.metrics;

	return [
		measure(lines, 'lines', baseline?.p95.lines),
		measure(maxDepth, 'depth', baseline?.p95.maxDepth),
		measure(params, 'params', baseline?.p95.params)
	].join(', ');
}

function clip(text: string, chars: number): string {
	return text.length > chars ? `${text.slice(0, chars)}…` : text;
}

/** Whether callers are shown: the declaration was deleted, or its signature or export status changed. */
function contractChanged(symbol: ChangedSymbol): boolean {
	return symbol.change === 'deleted' || symbol.previousSignature !== undefined;
}

/** The declaration as it reads now, and as it read before when that differs. */
function contractRow(symbol: ChangedSymbol): string {
	const was = symbol.previousSignature;
	const before = was !== undefined && was !== symbol.signature ? ` (was: ${clip(was, CONTRACT_CHARS)})` : '';

	return `  contract: ${clip(symbol.signature, CONTRACT_CHARS)}${before}`;
}

/** Call sites and tests for a changed contract: path:line and the trimmed source line. */
function callerRows(symbol: ChangedSymbol): string[] {
	const callers = symbol.callers ?? [];

	if (!callers.length) return symbol.usageUnknown ? [] : ['  callers: none found'];

	const tag = (ref: SymbolReference) => (ref.kind === 'test' ? ' [test]' : ref.inDiff ? ' [in this diff]' : '');

	return [
		'  callers:',
		...callers.map((ref) => `    ${ref.file}:${ref.line}${tag(ref)} ${clip(ref.text, CALLER_LINE_CHARS)}`)
	];
}

/** One symbol's text in the prompt, with the places it puts there and the ones a bound kept out. */
interface Block {
	text: string;
	supplied: ContextItem[];
	omitted: ContextOmission[];
}

/** One symbol's block in the prompt; `withCallers` false drops the call sites when the block would not fit. */
function describe(symbol: ChangedSymbol, baseline: RepoMetricsBaseline | undefined, withCallers = true): Block {
	const changed = contractChanged(symbol);
	const shown = changed && withCallers ? (symbol.callers ?? []) : [];
	const listed = new Set(shown.map((ref) => `${ref.file}:${ref.line}`));
	const others = symbol.references.filter((ref) => !listed.has(`${ref.file}:${ref.line}`));

	const rows = [
		`- ${symbol.qualifiedName} (${symbol.kind}, ${symbol.change}${symbol.exported ? ', exported' : ''}) ${symbol.file}:${symbol.startLine}-${symbol.endLine}`,
		changed ? contractRow(symbol) : `  signature: ${symbol.signature}`
	];

	if (changed && withCallers) rows.push(...callerRows(symbol));

	if (others.length) {
		rows.push('  referenced at:');
		for (const ref of others) rows.push(`    ${ref.file}:${ref.line} ${ref.text}`);
	}

	if (symbol.usageUnknown) rows.push('  references: not fully searched, so do not assume it is unused');

	if (symbol.calls.length) rows.push(`  calls: ${symbol.calls.join(', ')}`);
	if (symbol.tests.length) rows.push(`  tests: ${symbol.tests.join(', ')}`);

	if (symbol.examples.length) {
		const examples = symbol.examples.map((example) => `${example.file}:${example.startLine} ${example.qualifiedName}`);

		rows.push(`  comparable: ${examples.join('; ')}`);
	}

	if (symbol.change !== 'deleted' && isMeasured(symbol)) rows.push(`  size: ${metricsLine(symbol, baseline)}`);

	return { text: rows.join('\n'), ...suppliedBy(symbol, { changed, withCallers, shown, others }) };
}

/** The block, without its call sites when the full one would pass the room left. */
function blockWithin(symbol: ChangedSymbol, baseline: RepoMetricsBaseline | undefined, room: number): Block | null {
	const full = describe(symbol, baseline);

	if (full.text.length + 1 <= room) return full;

	const compact = describe(symbol, baseline, false);

	return compact.text.length + 1 <= room ? compact : null;
}

/** The prompt block on a scope's declarations, with what it supplies and what its size cap left out. */
export interface UnitContextParts {
	text: string;
	supplied: ContextItem[];
	omitted: ContextOmission[];
}

/**
 * The unit's prompt block and a record of it: every place the block puts in
 * front of the reviewer, and every declaration or caller its bounds cut. Same
 * model and scope, same text and same record.
 */
export function unitContextParts(model: ChangeModel, scope: UnitScope, maxChars = DEFAULT_MAX_CHARS): UnitContextParts {
	const symbols = scopeSymbols(model, scope);
	const baselines = new Map(model.baselines.map((baseline) => [baseline.language, baseline]));
	const header = 'Changed declarations (from the parser, not a model):';
	const blocks: Block[] = [];
	let used = header.length;

	for (const symbol of symbols) {
		const block = blockWithin(symbol, baselines.get(symbol.language), maxChars - TAIL_RESERVE - used);

		if (block === null) break;

		blocks.push(block);
		used += block.text.length + 1;
	}

	const cut = symbols.slice(blocks.length).map((symbol) => omission(sourceItem(symbol), 'context-cap'));
	const supplied = blocks.flatMap((block) => block.supplied);
	const omitted = [...blocks.flatMap((block) => block.omitted), ...cut];

	if (!blocks.length) return { text: '', supplied, omitted };

	const tail = cut.length ? `\n…${cut.length} more changed declaration${cut.length === 1 ? '' : 's'} not shown` : '';

	return { text: [header, ...blocks.map((block) => block.text)].join('\n') + tail, supplied, omitted };
}

/**
 * A plain-text prompt block on the declarations the scope touches: what each
 * is, who references it, what it calls, its tests, comparable code and its
 * size against the repo. A declaration whose signature or export changed also
 * lists its call sites and tests, one source line each. Same model and scope, same text. Empty when the scope
 * touches no parsed symbol.
 */
export function unitContext(model: ChangeModel, scope: UnitScope, maxChars = DEFAULT_MAX_CHARS): string {
	return unitContextParts(model, scope, maxChars).text;
}
