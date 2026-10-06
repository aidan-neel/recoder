import type { Obligation, ObligationTrigger } from '@recoder/shared';
import { fileHunks } from '../change-model/change-model.js';
import { languageFor } from '../change-model/languages.js';
import { innermost } from '../change-model/owners.js';
import { withTree } from '../change-model/parser.js';
import { byCodePoint, readAt, readTracked, trackedFiles } from '../change-model/repo.js';
import { isTestPath } from '../change-model/test-files.js';
import type { ChangedSymbol, ChangeModel } from '../change-model/types.js';
import type { InventoryFile, ReviewInventory } from '../inventory.js';
import { partitionUnits } from '../units.js';
import { collectMarks, type Mark } from './marks.js';
import { squash } from './syntax.js';
import { QUESTIONS, TRIGGERS, triggerHits, type TriggerHit } from './triggers.js';

/** Grammars the trigger rules are written for; other changed files derive nothing. */
const LANGUAGES = new Set(['typescript', 'tsx', 'javascript', 'svelte']);

/** The lens whose specialist owns a trigger's question; correctness for the rest. */
const SPECIALISTS: Partial<Record<ObligationTrigger, string>> = {
	'removed-guard': 'security',
	'error-contract': 'api-contract',
	'resource-release': 'concurrency'
};

/**
 * Triggers about the code under test, which a test's own conditions, timers,
 * scratch directories and stub errors would only trip; test files derive none.
 */
const SOURCE_ONLY = new Set<ObligationTrigger>(['truthy-default', 'boundary', 'resource-release', 'error-contract']);

/** Tests and callers listed per obligation, at most. */
const MAX_HINTS = 3;

/** What derivation reads: the change, its model, and both sides of each file from the checkout. */
export interface DeriveInput {
	inventory: ReviewInventory;
	changeModel: ChangeModel | null;
	checkoutPath: string;
	/** Without the merge base only head-side triggers can fire. */
	baseSha: string | null;
	signal: AbortSignal;
}

type Draft = Omit<Obligation, 'id'>;

/**
 * Every obligation the change sets off, in file, line and trigger order. No
 * model calls: the same checkout and diff always give the same obligations.
 */
export async function deriveObligations(input: DeriveInput): Promise<Obligation[]> {
	const { inventory, checkoutPath, signal } = input;
	const tracked = new Set(await trackedFiles(checkoutPath, signal));
	const units = partitionUnits(inventory);
	const drafts: Draft[] = [];

	for (const file of inventory.files) {
		if (signal.aborted) throw new Error('obligation derivation aborted');

		const unit = units.find((entry) => entry.scope.some((scope) => scope.path === file.path));
		const language = languageFor(file.path);

		if (unit && language && LANGUAGES.has(language)) drafts.push(...(await fileDrafts(input, file, unit.id, tracked)));
	}

	return dedupe(drafts)
		.sort(byPlace)
		.map((draft, index) => ({ id: `obligation-${index + 1}`, ...draft }));
}

/**
 * At most `cap` obligations, one of each trigger in turn, so a change full of
 * comparisons still gets its removed guard investigated. Kept in derived order.
 */
export function selectUnderCap(obligations: Obligation[], cap: number): Obligation[] {
	const queues = TRIGGERS.map((trigger) => obligations.filter((entry) => entry.trigger === trigger));
	const chosen = new Set<Obligation>();

	for (let round = 0; chosen.size < cap && queues.some((queue) => queue.length > round); round++) {
		for (const queue of queues) if (queue[round] && chosen.size < cap) chosen.add(queue[round]);
	}

	return obligations.filter((entry) => chosen.has(entry));
}

async function fileDrafts(
	input: DeriveInput,
	file: InventoryFile,
	unitId: string,
	tracked: Set<string>
): Promise<Draft[]> {
	const hunks = fileHunks(input.inventory, file);
	const test = isTestPath(file.path);
	const basePath = file.oldPath ?? file.path;
	const headSource = file.status === 'deleted' ? null : await readTracked(input.checkoutPath, file.path, tracked);

	const baseSource =
		input.baseSha && file.status !== 'added'
			? await readAt(input.checkoutPath, input.baseSha, basePath, input.signal)
			: null;

	const head = await marksOf(
		file.path,
		headSource,
		hunks.flatMap((hunk) => hunk.added),
		test
	);

	const base = await marksOf(
		basePath,
		baseSource,
		hunks.flatMap((hunk) => hunk.deleted),
		test
	);

	const headText = squash(headSource ?? '');
	const baseText = squash(baseSource ?? '');

	return hunks.flatMap((hunk) => {
		const added = new Set(hunk.added);
		const deleted = new Set(hunk.deleted);

		const hits = triggerHits({
			base: base.filter((mark) => deleted.has(mark.line)),
			head: head.filter((mark) => added.has(mark.line)),
			headText,
			baseText,
			deletes: hunk.deleted.length > 0
		});

		return hits
			.filter((hit) => !(test && SOURCE_ONLY.has(hit.trigger)))
			.flatMap((hit) => draftOf(input.changeModel, file.path, hunk.id, unitId, hit));
	});
}

async function marksOf(path: string, source: string | null, lines: number[], test: boolean): Promise<Mark[]> {
	if (source === null || !lines.length) return [];

	return (await withTree(path, source, (root) => collectMarks(root, new Set(lines), test))) ?? [];
}

/**
 * The obligation for one hit, attached to its unit and enclosing symbol. Code
 * removed along with its whole declaration obliges nothing, and neither does
 * error text in a declaration the change adds: there was no contract before.
 */
function draftOf(model: ChangeModel | null, file: string, hunkId: string, unitId: string, hit: TriggerHit): Draft[] {
	const owner = ownerOf(model, file, hunkId, hit);

	if (hit.side === 'old' && owner?.change === 'deleted') return [];
	if (hit.trigger === 'error-contract' && owner?.change === 'added') return [];

	return [
		{
			unitId,
			hunkId,
			specialist: SPECIALISTS[hit.trigger] ?? 'correctness',
			trigger: hit.trigger,
			question: QUESTIONS[hit.trigger],
			location: { file, line: hit.line, side: hit.side },
			code: hit.code,
			symbol: owner?.qualifiedName ?? null,
			contractHints: hintsFor(owner, hit)
		}
	];
}

/**
 * The innermost changed symbol around the hit: a deleted one for removed code
 * inside a removed declaration, else the surviving declaration the hunk changed.
 */
function ownerOf(model: ChangeModel | null, file: string, hunkId: string, hit: TriggerHit): ChangedSymbol | null {
	if (!model) return null;

	const ids = new Set(model.byHunk[hunkId] ?? []);
	const touched = model.symbols.filter((symbol) => symbol.file === file && ids.has(symbol.id));
	const sameSide = touched.filter((symbol) => (symbol.change === 'deleted') === (hit.side === 'old'));
	const index = innermost(sameSide, hit.line);

	if (index >= 0) return sameSide[index];

	return hit.side === 'old' ? (touched.find((symbol) => symbol.change !== 'deleted') ?? null) : null;
}

function hintsFor(owner: ChangedSymbol | null, hit: TriggerHit): string[] {
	return [
		hit.detail,
		owner ? `Signature: ${owner.signature}` : '',
		owner?.previousSignature ? `Signature before the change: ${owner.previousSignature}` : '',
		...(owner?.tests ?? []).slice(0, MAX_HINTS).map((test) => `Test: ${test}`),
		...(owner?.callers ?? [])
			.slice(0, MAX_HINTS)
			.map((caller) => `Caller: ${caller.file}:${caller.line} ${caller.text}`)
	].filter(Boolean);
}

function dedupe(drafts: Draft[]): Draft[] {
	const seen = new Set<string>();

	return drafts.filter((draft) => {
		const key = `${draft.trigger}\0${draft.location.file}\0${draft.location.side}\0${draft.location.line}`;

		if (seen.has(key)) return false;

		seen.add(key);

		return true;
	});
}

function byPlace(a: Draft, b: Draft): number {
	return (
		byCodePoint(a.location.file, b.location.file) ||
		(a.location.side === b.location.side ? 0 : a.location.side === 'new' ? -1 : 1) ||
		a.location.line - b.location.line ||
		TRIGGERS.indexOf(a.trigger) - TRIGGERS.indexOf(b.trigger)
	);
}
