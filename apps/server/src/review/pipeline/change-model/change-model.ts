import type { InventoryFile, ReviewInventory } from '../inventory.js';
import { findExamples } from './examples.js';
import { languageFor } from './languages.js';
import { repoBaselines } from './metrics.js';
import { hunkLines, innermost, type HunkLines } from './owners.js';
import { findUsage } from './references.js';
import { byCodePoint, readAt, readTracked, trackedFiles } from './repo.js';
import { symbolsOf, type ParsedSymbol } from './symbols.js';
import type { ChangedSymbol, ChangeModel } from './types.js';

export { symbolAt, unitContext } from './lookup.js';

/** What the change model is built from. */
interface ChangeModelInput {
	inventory: ReviewInventory;
	/** The PR head checkout, a git work tree. */
	checkoutPath: string;
	signal: AbortSignal;
	/** The merge base, when known; deleted declarations are read from it. Without it only head-side symbols are found. */
	baseSha?: string;
}

/** A changed symbol before references, tests and examples are attached. */
type Owned = ParsedSymbol & {
	id: string;
	change: ChangedSymbol['change'];
	hunkIds: string[];
	previousSignature?: string;
};

/** One changed file's symbols, or why it has none. */
interface FileResult {
	owned: Owned[];
	unparsed: boolean;
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw new Error('change model aborted');
}

/** `${file}#${qualifiedName}`, with `:2`, `:3`… for later declarations of the same name in the file. */
function assignIds(symbols: ParsedSymbol[]): string[] {
	const seen = new Map<string, number>();

	return symbols.map((symbol) => {
		const base = `${symbol.file}#${symbol.qualifiedName}`;
		const count = (seen.get(base) ?? 0) + 1;

		seen.set(base, count);

		return count === 1 ? base : `${base}:${count}`;
	});
}

/** Symbol index → the hunk ids whose changed lines it owns, as the innermost declaration around them. */
function ownersOf(symbols: ParsedSymbol[], hunks: HunkLines[], side: 'new' | 'old'): Map<number, string[]> {
	const owners = new Map<number, string[]>();

	const own = (index: number, id: string) => {
		if (index < 0) return;

		const ids = owners.get(index) ?? [];

		if (!ids.includes(id)) ids.push(id);
		owners.set(index, ids);
	};

	for (const hunk of hunks) {
		if (side === 'old') {
			for (const line of hunk.deleted) own(innermost(symbols, line), hunk.id);
			continue;
		}

		for (const line of hunk.added) own(innermost(symbols, line), hunk.id);
		for (const gap of hunk.gaps) own(innermost(symbols, gap, gap + 1), hunk.id);
	}

	return owners;
}

/** Head-side symbols the diff touches. */
function headOwned(file: InventoryFile, symbols: ParsedSymbol[], hunks: HunkLines[]): Owned[] {
	const ids = assignIds(symbols);
	const added = new Set(hunks.flatMap((hunk) => hunk.added));

	return [...ownersOf(symbols, hunks, 'new')].map(([index, hunkIds]) => {
		const symbol = symbols[index];
		let whollyAdded = file.status === 'added';

		for (let line = symbol.startLine; !whollyAdded && line <= symbol.endLine; line++) {
			if (!added.has(line)) break;
			if (line === symbol.endLine) whollyAdded = true;
		}

		return { ...symbol, id: ids[index], change: whollyAdded ? 'added' : 'modified', hunkIds };
	});
}

/** Merge-base symbols whose deleted lines they own and whose name no longer exists at the head. */
function deletedOwned(old: ParsedSymbol[], head: ParsedSymbol[], hunks: HunkLines[]): Owned[] {
	const surviving = new Set(head.map((symbol) => symbol.qualifiedName));
	const ids = assignIds(old);

	return [...ownersOf(old, hunks, 'old')]
		.filter(([index]) => !surviving.has(old[index].qualifiedName))
		.map(([index, hunkIds]) => ({ ...old[index], id: ids[index], change: 'deleted' as const, hunkIds }));
}

/** A file's hunks as changed lines on both sides. */
function fileHunks(inventory: ReviewInventory, file: InventoryFile): HunkLines[] {
	const diff = inventory.diffs.find((entry) => entry.path === file.path);

	return hunkLines(
		file.hunks.map((hunk) => hunk.id),
		diff?.hunks ?? []
	);
}

/** File → the head-side lines the diff adds, so a call site can be told apart from code the PR already rewrote. */
function addedLines(inventory: ReviewInventory, files: InventoryFile[]): Map<string, Set<number>> {
	return new Map(files.map((file) => [file.path, new Set(fileHunks(inventory, file).flatMap((hunk) => hunk.added))]));
}

/** Marks a modified declaration whose signature or export status differs from the merge base's. */
function withPrevious(owned: Owned[], old: ParsedSymbol[]): Owned[] {
	const ids = assignIds(old);
	const before = new Map(old.map((symbol, index) => [ids[index], symbol]));

	return owned.map((symbol) => {
		const prior = before.get(symbol.id);

		if (symbol.change !== 'modified' || !prior) return symbol;

		return prior.signature !== symbol.signature || prior.exported !== symbol.exported
			? { ...symbol, previousSignature: prior.signature }
			: symbol;
	});
}

async function modelFile(input: ChangeModelInput, file: InventoryFile, tracked: Set<string>): Promise<FileResult> {
	const hunks = fileHunks(input.inventory, file);

	const headSource = file.status === 'deleted' ? null : await readTracked(input.checkoutPath, file.path, tracked);
	const head = headSource === null ? null : await symbolsOf(file.path, headSource);
	const wantOld = Boolean(input.baseSha) && file.status !== 'added' && file.deletions > 0;
	const oldSource = wantOld ? await readAt(input.checkoutPath, input.baseSha!, file.path, input.signal) : null;
	const old = oldSource === null ? null : await symbolsOf(file.path, oldSource);

	if (!head && !old) return { owned: [], unparsed: true };

	return {
		owned: [
			...withPrevious(headOwned(file, head ?? [], hunks), old ?? []),
			...deletedOwned(old ?? [], head ?? [], hunks)
		],
		unparsed: false
	};
}

function bySymbolOrder(a: Owned, b: Owned): number {
	return byCodePoint(a.file, b.file) || a.startLine - b.startLine || byCodePoint(a.id, b.id);
}

/**
 * The deterministic model of the changed code: every declaration the diff
 * touches, with its signature, callees, references, tests, comparable code and
 * shape against the repo's own baseline. No model calls; the same checkout and
 * diff always give the same model.
 */
export async function buildChangeModel(input: ChangeModelInput): Promise<ChangeModel> {
	const { inventory, checkoutPath, signal } = input;
	const tracked = await trackedFiles(checkoutPath, signal);
	const trackedSet = new Set(tracked);

	const files = inventory.files.filter((file) => !file.excludeReason).sort((a, b) => byCodePoint(a.path, b.path));

	const owned: Owned[] = [];
	const unparsed: string[] = [];

	for (const file of files) {
		throwIfAborted(signal);

		const result = languageFor(file.path) ? await modelFile(input, file, trackedSet) : null;

		if (!result || result.unparsed) unparsed.push(file.path);
		else owned.push(...result.owned);
	}

	owned.sort(bySymbolOrder);
	throwIfAborted(signal);

	const searched = owned.map((symbol) => ({ ...symbol, deleted: symbol.change === 'deleted' }));
	const usage = await findUsage(checkoutPath, searched, tracked, addedLines(inventory, files), signal);

	throwIfAborted(signal);

	const changedKeys = new Set(owned.map((symbol) => `${symbol.file}\0${symbol.qualifiedName}`));
	const examples = await findExamples(checkoutPath, owned, changedKeys, tracked, signal);

	throwIfAborted(signal);

	const baselines = await repoBaselines(
		checkoutPath,
		owned.map((symbol) => symbol.language),
		tracked,
		signal
	);

	throwIfAborted(signal);

	const symbols: ChangedSymbol[] = owned.map((symbol, index) => ({
		...symbol,
		references: usage[index].references,
		callers: usage[index].callers,
		...(usage[index].omittedCallers.length ? { omittedCallers: usage[index].omittedCallers } : {}),
		...(usage[index].searched ? {} : { usageUnknown: true as const }),
		tests: usage[index].tests,
		examples: symbol.change === 'deleted' ? [] : examples[index]
	}));

	return { symbols, byHunk: hunkIndex(files, symbols), baselines, unparsed };
}

/** Every hunk of every reviewed file → the ids of the symbols it touches, in model order. */
function hunkIndex(files: InventoryFile[], symbols: ChangedSymbol[]): Record<string, string[]> {
	const byHunk: Record<string, string[]> = {};

	for (const file of files) for (const hunk of file.hunks) byHunk[hunk.id] = [];
	for (const symbol of symbols) for (const id of symbol.hunkIds) byHunk[id]?.push(symbol.id);

	return byHunk;
}
