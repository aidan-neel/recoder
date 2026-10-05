import { createHash } from 'node:crypto';
import { isTestPath } from '../change-model/test-files.js';
import { normalizedTokens } from '../change-model/tokens.js';
import { classifyPath } from '../review-scope.js';
import { compareText, type AddedLines } from './changed-lines.js';
import { MAX_FILE_BYTES, readFilesAt, type TrackedFile } from './repo-files.js';
import { windowHashes } from './window-hash.js';
import type { DetectorResult } from './types.js';

/** Tokens per hashed window; a clone must contain at least one whole window. */
const WINDOW = 50;

/** Matching tokens before a repeat counts as a clone. */
const MIN_CLONE = 60;

/** Repo files compared against the change, besides the changed files themselves. */
const MAX_SAMPLE = 400;

/** A clone is reported only when the change wrote at least this share of its copy. */
const MIN_ADDED_SHARE = 0.5;

const MAX_PER_FILE = 3;

/** Extensions whose tokens are comparable with each other. */
const FAMILIES: Record<string, string> = {
	ts: 'js',
	tsx: 'js',
	mts: 'js',
	cts: 'js',
	js: 'js',
	jsx: 'js',
	mjs: 'js',
	cjs: 'js',
	svelte: 'js',
	vue: 'js'
};

/** What the duplication detector reads. */
export interface DuplicationInput {
	cwd: string;
	headSha: string;
	signal: AbortSignal;
	added: AddedLines;
	/** Changed files' text at the PR head. */
	heads: Map<string, string>;
	tracked: TrackedFile[];
}

interface Tokenized {
	path: string;
	ids: number[];
	lines: number[];
	/** Prefix count of tokens on added lines; empty for files outside the change. */
	addedBefore: number[];
}

interface Clone {
	a: Tokenized;
	aStart: number;
	b: Tokenized;
	bStart: number;
	length: number;
}

function family(path: string): string {
	const ext = path.split('.').pop()?.toLowerCase() ?? '';

	return FAMILIES[ext] ?? ext;
}

function dirOf(path: string): string {
	return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

/**
 * Repo files in the change's languages, same-folder files first, the rest in
 * hash order: a capped sample that is the same on every run of the same commit.
 */
function sampleFiles(tracked: TrackedFile[], changed: string[]): string[] {
	const families = new Set(changed.map(family));
	const dirs = new Set(changed.map(dirOf));
	const skip = new Set(changed);
	const hash = (path: string) => createHash('sha1').update(path).digest('hex');

	return tracked
		.filter(
			(file) =>
				!skip.has(file.path) &&
				file.size <= MAX_FILE_BYTES &&
				families.has(family(file.path)) &&
				!classifyPath(file.path).excludeReason
		)
		.map((file) => ({ path: file.path, near: dirs.has(dirOf(file.path)) ? 0 : 1, key: hash(file.path) }))
		.sort((a, b) => a.near - b.near || compareText(a.key, b.key))
		.slice(0, MAX_SAMPLE)
		.map((file) => file.path);
}

/** Tokens as small integers (one id per distinct normalized text), with their lines and added-token counts. */
async function tokenize(
	path: string,
	text: string,
	ids: Map<string, number>,
	added: Map<number, string> | undefined
): Promise<Tokenized | null> {
	const tokens = await normalizedTokens(path, text);

	if (!tokens || tokens.length < WINDOW) return null;

	const addedBefore = [0];

	for (const token of tokens) addedBefore.push(addedBefore.at(-1)! + (added?.has(token.line) ? 1 : 0));

	return {
		path,
		ids: tokens.map((token) => {
			if (!ids.has(token.text)) ids.set(token.text, ids.size + 1);

			return ids.get(token.text)!;
		}),
		lines: tokens.map((token) => token.line),
		addedBefore: added ? addedBefore : []
	};
}

function addedIn(file: Tokenized, start: number, length: number): number {
	return file.addedBefore.length ? file.addedBefore[start + length] - file.addedBefore[start] : 0;
}

/** Window hash → the changed windows with it; only windows holding an added token are indexed. */
function indexChanged(changed: Tokenized[]): Map<number, { file: Tokenized; start: number }[]> {
	const index = new Map<number, { file: Tokenized; start: number }[]>();

	for (const file of changed) {
		windowHashes(file.ids, WINDOW).forEach((hash, start) => {
			if (!addedIn(file, start, WINDOW)) return;

			const entries = index.get(hash) ?? [];

			entries.push({ file, start });
			index.set(hash, entries);
		});
	}

	return index;
}

/** The maximal run of equal tokens through a matching window, or null on a hash collision. */
function extend(a: Tokenized, aStart: number, b: Tokenized, bStart: number): Clone | null {
	for (let k = 0; k < WINDOW; k++) if (a.ids[aStart + k] !== b.ids[bStart + k]) return null;

	let i = aStart;
	let j = bStart;

	while (i > 0 && j > 0 && a.ids[i - 1] === b.ids[j - 1]) {
		i--;
		j--;
	}

	let length = WINDOW + (aStart - i);

	while (i + length < a.ids.length && j + length < b.ids.length && a.ids[i + length] === b.ids[j + length]) length++;

	return { a, aStart: i, b, bStart: j, length };
}

/** Every maximal repeat between a changed window and `target`, skipping a file's overlap with itself. */
function clonesIn(target: Tokenized, index: Map<number, { file: Tokenized; start: number }[]>): Clone[] {
	const covered = new Map<string, number>();
	const clones: Clone[] = [];

	windowHashes(target.ids, WINDOW).forEach((hash, bStart) => {
		for (const entry of index.get(hash) ?? []) {
			const key = `${entry.file.path}\0${bStart - entry.start}`;

			if (bStart < (covered.get(key) ?? 0)) continue;

			const clone = extend(entry.file, entry.start, target, bStart);

			if (!clone) continue;

			covered.set(key, clone.bStart + clone.length);

			const overlaps =
				clone.a === target && clone.aStart < clone.bStart + clone.length && clone.bStart < clone.aStart + clone.length;

			if (!overlaps) clones.push(clone);
		}
	});

	return clones;
}

/** Copies of existing code first (the fix is to reuse it), then longer clones, then by place. */
function cloneOrder(x: Clone, y: Clone): number {
	return (
		Number(x.b.addedBefore.length > 0) - Number(y.b.addedBefore.length > 0) ||
		y.length - x.length ||
		compareText(x.a.path, y.a.path) ||
		x.aStart - y.aStart ||
		compareText(x.b.path, y.b.path) ||
		x.bStart - y.bStart
	);
}

/**
 * Long enough, mostly written by the change, one report per pair, and at most
 * a few non-overlapping ones per file. Repeats inside a test file are left
 * alone: test setup repeats by design and reporting it buries real findings.
 */
function keepClones(clones: Clone[]): Clone[] {
	const pairs = new Set<string>();
	const kept = new Map<string, Clone[]>();

	for (const clone of clones.sort(cloneOrder)) {
		const mostlyAdded = addedIn(clone.a, clone.aStart, clone.length) >= clone.length * MIN_ADDED_SHARE;

		if (clone.length < MIN_CLONE || !mostlyAdded || isTestPath(clone.a.path)) continue;

		const ends = [`${clone.a.path}:${clone.aStart}`, `${clone.b.path}:${clone.bStart}`].sort(compareText);
		const pair = `${ends.join('|')}|${clone.length}`;
		const inFile = kept.get(clone.a.path) ?? [];

		const overlaps = inFile.some(
			(other) => clone.aStart < other.aStart + other.length && other.aStart < clone.aStart + clone.length
		);

		if (pairs.has(pair) || overlaps || inFile.length >= MAX_PER_FILE) continue;

		pairs.add(pair);
		kept.set(clone.a.path, [...inFile, clone]);
	}

	return [...kept.values()].flat();
}

function toResult(clone: Clone): DetectorResult {
	const { a, b } = clone;
	const line = a.lines[clone.aStart];
	const endLine = a.lines[clone.aStart + clone.length - 1];
	const otherLine = b.lines[clone.bStart];
	const otherEnd = b.lines[clone.bStart + clone.length - 1];
	const other = `${b.path}:${otherLine}-${otherEnd}`;

	return {
		detector: 'duplication',
		category: 'duplication',
		title: `Repeats code from ${b.path === a.path ? 'elsewhere in this file' : b.path}`,
		body: `Lines ${line}-${endLine} repeat ${clone.length} tokens of \`${other}\`. Move the shared logic into one function both places call.`,
		file: a.path,
		line,
		endLine,
		evidence: `${clone.length} matching normalized tokens: ${a.path}:${line}-${endLine} and ${other}.`,
		relatedLocations: [{ file: b.path, line: otherLine, endLine: otherEnd }]
	};
}

/**
 * Code the change adds that repeats at least `MIN_CLONE` normalized tokens of
 * code elsewhere: in another changed file, another place in the same file, or
 * a capped, deterministic sample of same-language files at the PR head.
 */
export async function duplicationResults(input: DuplicationInput): Promise<DetectorResult[]> {
	const ids = new Map<string, number>();
	const changed: Tokenized[] = [];

	for (const [path, text] of [...input.heads].sort(([a], [b]) => compareText(a, b))) {
		const file = input.added.has(path) ? await tokenize(path, text, ids, input.added.get(path)) : null;

		if (file) changed.push(file);
	}

	if (!changed.length) return [];

	const index = indexChanged(changed);

	const sample = sampleFiles(
		input.tracked,
		changed.map((file) => file.path)
	);

	const texts = await readFilesAt(input.cwd, input.headSha, sample, input.signal);
	const clones = changed.flatMap((file) => clonesIn(file, index));

	for (const path of sample) {
		const text = texts.get(path);
		const file = text === undefined ? null : await tokenize(path, text, ids, undefined);

		if (file) clones.push(...clonesIn(file, index));
	}

	return keepClones(clones).map(toResult);
}
