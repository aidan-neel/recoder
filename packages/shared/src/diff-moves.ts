import type { DiffLine, FileDiff } from './diff';

/** A null end denotes a whole file whose line count is absent from a metadata-only patch. */
export interface MoveRange {
	start: number;
	end: number | null;
}

/** Source coordinates refer to the pre-change tree; destination coordinates refer to the head. */
export interface DiffMove {
	fromPath: string;
	fromLines: MoveRange;
	toPath: string;
	toLines: MoveRange;
	kind: 'moved' | 'copied' | 'renamed-file';
	exact: boolean;
	match?: 'exact' | 'modified-small';
}

interface Block {
	path: string;
	removed: boolean;
	lines: { no: number; text: string }[];
}

interface Match {
	source: Block;
	target: Block;
	from: number;
	to: number;
	length: number;
	exact: boolean;
}

/** Trim indentation, not interior whitespace: spaces inside strings can change behavior. */
function normalized(line: DiffLine): string {
	return line.text.trim();
}

function blocks(files: readonly FileDiff[], type: DiffLine['type']): Block[] {
	const result: Block[] = [];

	for (const file of files) {
		for (const hunk of file.hunks) {
			let block: Block | null = null;

			for (const line of hunk.lines) {
				if (line.type !== type) {
					block = null;
					continue;
				}

				if (!block) {
					block = {
						path: type === 'add' ? file.path : (file.oldPath ?? file.path),
						removed: type === 'del',
						lines: []
					};

					result.push(block);
				}

				const text = normalized(line);
				const no = type === 'add' ? line.newNo : line.oldNo;

				if (text && no !== null) block.lines.push({ no, text });
			}
		}
	}

	return result.filter((block) => block.lines.length >= 3);
}

function anchor(block: Block, index: number): string {
	return JSON.stringify(block.lines.slice(index, index + 3).map((line) => line.text));
}

/** Maximal exact blocks, seeded by three non-blank lines. Repeated seeds fail closed rather than exploding in cost. */
function exactMatches(sources: Block[], targets: Block[]): Match[] {
	const index = new Map<string, { block: Block; offset: number }[] | null>();
	const matches = new Map<string, Match>();
	const covered = new Map<string, number>();
	const ids = new Map(sources.map((block, index) => [block, index]));

	for (const block of sources) {
		for (let offset = 0; offset <= block.lines.length - 3; offset++) {
			const key = anchor(block, offset);
			const entries = index.get(key);

			if (entries === null) continue;
			if (entries && entries.length >= 32) index.set(key, null);
			else index.set(key, [...(entries ?? []), { block, offset }]);
		}
	}

	for (const [targetId, target] of targets.entries()) {
		for (let offset = 0; offset <= target.lines.length - 3; offset++) {
			for (const { block: source, offset: start } of index.get(anchor(target, offset)) ?? []) {
				const diagonal = `${ids.get(source)}:${targetId}:${start - offset}`;

				if ((covered.get(diagonal) ?? -1) >= offset + 2) continue;

				let from = start;
				let to = offset;
				let length = 3;

				while (from > 0 && to > 0 && source.lines[from - 1].text === target.lines[to - 1].text) {
					from--;
					to--;
					length++;
				}

				while (
					from + length < source.lines.length &&
					to + length < target.lines.length &&
					source.lines[from + length].text === target.lines[to + length].text
				)
					length++;

				const match = { source, target, from, to, length, exact: true };
				const key = JSON.stringify([source.path, source.lines[from].no, target.path, target.lines[to].no, length]);

				matches.set(key, match);
				covered.set(diagonal, to + length - 1);
			}
		}
	}

	return [...matches.values()];
}

/** A bounded edit distance avoids labelling an arbitrary changed statement a small modification. */
function near(a: string, b: string, limit: number): boolean {
	if (Math.abs(a.length - b.length) > limit || Math.max(a.length, b.length) > 2000) return false;

	let row = Array.from({ length: b.length + 1 }, (_, index) => index);

	for (let i = 1; i <= a.length; i++) {
		const next = [i];

		for (let j = 1; j <= b.length; j++)
			next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + Number(a[i - 1] !== b[j - 1]));
		if (Math.min(...next) > limit) return false;
		row = next;
	}

	return row[b.length] <= limit;
}

function signatures(block: Block): string[] {
	const positions = [0, Math.floor(block.lines.length / 2), block.lines.length - 1];

	return [
		[0, 1],
		[0, 2],
		[1, 2]
	].map(([a, b]) =>
		JSON.stringify([block.lines.length, a, b, block.lines[positions[a]].text, block.lines[positions[b]].text])
	);
}

/** One lightly edited line in an otherwise equal deleted/added block, anchored by two unchanged lines. */
function modifiedMatches(sources: Block[], targets: Block[]): Match[] {
	const index = new Map<string, Block[] | null>();
	const matches: Match[] = [];

	for (const source of sources) {
		for (const key of signatures(source)) {
			const entries = index.get(key);

			if (entries === null) continue;
			index.set(key, entries && entries.length >= 32 ? null : [...(entries ?? []), source]);
		}
	}

	for (const target of targets) {
		const keys = signatures(target);

		if (keys.some((key) => index.get(key) === null)) continue;

		const candidates = new Set(keys.flatMap((key) => index.get(key) ?? []));

		if (candidates.size > 32) continue;

		for (const source of candidates) {
			const different = source.lines.flatMap((line, i) => (line.text === target.lines[i].text ? [] : [i]));

			if (different.length !== 1) continue;

			const at = different[0];
			const limit = Math.max(1, Math.floor(source.lines.reduce((sum, line) => sum + line.text.length, 0) * 0.1));

			if (near(source.lines[at].text, target.lines[at].text, limit))
				matches.push({ source, target, from: 0, to: 0, length: source.lines.length, exact: false });
		}
	}

	return matches;
}

function overlap(a: Match, b: Match, side: 'source' | 'target'): boolean {
	const field = side === 'source' ? 'from' : 'to';
	const startA = a[side].lines[a[field]].no;
	const endA = a[side].lines[a[field] + a.length - 1].no;
	const startB = b[side].lines[b[field]].no;
	const endB = b[side].lines[b[field] + b.length - 1].no;

	return a[side].path === b[side].path && startA <= endB && startB <= endA;
}

function score(match: Match): number {
	return match.length - (match.exact ? 0 : 0.25);
}

function relation(match: Match): DiffMove {
	return {
		fromPath: match.source.path,
		fromLines: { start: match.source.lines[match.from].no, end: match.source.lines[match.from + match.length - 1].no },
		toPath: match.target.path,
		toLines: { start: match.target.lines[match.to].no, end: match.target.lines[match.to + match.length - 1].no },
		kind: match.source.removed ? 'moved' : 'copied',
		exact: match.exact,
		match: match.exact ? 'exact' : 'modified-small'
	};
}

/**
 * Conservative move/copy relations using only patch content. Copies can be found only from unchanged context
 * present in the patch, not unseen repository files. A modified-small move differs in one line by at most 10%
 * of the block's characters. Content identity does not establish behavioral equivalence at a new location.
 */
export function detectMoves(files: readonly FileDiff[]): DiffMove[] {
	const deleted = blocks(files, 'del');
	const added = blocks(files, 'add');

	const candidates = [
		...exactMatches([...deleted, ...blocks(files, 'context')], added),
		...modifiedMatches(deleted, added)
	];

	const accepted = candidates.filter(
		(candidate) =>
			!candidates.some(
				(other) =>
					other !== candidate &&
					score(other) >= score(candidate) &&
					(overlap(candidate, other, 'target') || (candidate.source.removed && overlap(candidate, other, 'source')))
			)
	);

	const renamed: DiffMove[] = files
		.filter((file) => (file.status === 'renamed' || file.status === 'copied') && file.oldPath)
		.map((file) => ({
			fromPath: file.oldPath!,
			fromLines: { start: 1, end: null },
			toPath: file.path,
			toLines: { start: 1, end: null },
			kind: file.status === 'copied' ? 'copied' : 'renamed-file',
			exact: file.similarity === 100 && file.additions === 0 && file.deletions === 0,
			match: file.similarity === 100 && file.additions === 0 && file.deletions === 0 ? 'exact' : undefined
		}));

	return [...renamed, ...accepted.map(relation)].sort(
		(a, b) =>
			a.toPath.localeCompare(b.toPath) || a.toLines.start - b.toLines.start || a.fromPath.localeCompare(b.fromPath)
	);
}

/** Attach destination relations before expanding context; expanded head-side lines are not evidence of old content. */
export function withDiffMoves(files: FileDiff[]): FileDiff[] {
	const moves = detectMoves(files);

	return files.map((file) => ({ ...file, moves: moves.filter((move) => move.toPath === file.path) }));
}
