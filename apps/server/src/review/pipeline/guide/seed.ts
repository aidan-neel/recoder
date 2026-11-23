import { byCodePoint, type DiffGuide, type DiffGuideHunk } from '@recoder/shared';
import { definiteImportTargets } from '../change-model/imports.js';
import { isTestPath, testSourceKey } from '../change-model/test-files.js';
import type { ChangeModel } from '../change-model/types.js';
import type { ReviewInventory } from '../inventory.js';
import { pureMoveAt } from '../move-awareness.js';
import { unitTitle } from '../units.js';

const COMMON = new Set(
	'const let var function return export import from async await class interface type string number boolean undefined null true false this throw error value name length default else await void public private static readonly new Promise Array Object'.split(
		' '
	)
);

/** Presentation priority is independent of the file's lexical order. */
function rank(inventory: ReviewInventory, path: string): 0 | 1 | 2 {
	const kind = inventory.files.find((file) => file.path === path)?.classification;

	return kind === 'test' || isTestPath(path) ? 1 : kind === 'docs' || kind === 'config' || kind === 'lockfile' ? 2 : 0;
}

/** The first ready file in lexical order, or the first remaining file if dependencies form a cycle. */
function nextInPhase(phase: Set<string>, dependencies: Map<string, Set<string>>): string {
	paths: for (const path of phase) {
		for (const other of dependencies.get(path)!) if (phase.has(other)) continue paths;

		return path;
	}

	return phase.values().next().value!;
}

/** Every hunk has its inventory id; metadata-only renames get one explicit navigation entry. */
function entries(inventory: ReviewInventory): DiffGuideHunk[] {
	return inventory.files.flatMap((file) => {
		if (!file.hunks.length && file.status === 'renamed' && file.oldPath) {
			return [{ id: `${file.path}:renamed-file`, file: file.path, note: `moved from ${file.oldPath}` }];
		}

		const diff = inventory.diffs.find((entry) => entry.path === file.path);

		return file.hunks.map((hunk, index) => {
			const changed = diff?.hunks[index]?.lines.filter((line) => line.type !== 'context' && line.text.trim()) ?? [];

			const moves = changed.map((line) =>
				pureMoveAt(
					inventory,
					file.path,
					(line.type === 'del' ? line.oldNo : line.newNo) ?? undefined,
					line.type === 'del' ? 'old' : 'new'
				)
			);

			const note = moves.length && moves.every(Boolean) ? `moved from ${moves[0]!.fromPath}` : undefined;

			return { id: hunk.id, file: file.path, ...(note && { note }) };
		});
	});
}

/** Connected hunks, ordered dependency-first with stable cycle breaking, tests next and ancillary files last. */
export function seedDiffGuide(inventory: ReviewInventory, model: ChangeModel | null): DiffGuide {
	const hunks = entries(inventory);
	const paths = [...new Set(hunks.map((hunk) => hunk.file))].sort(byCodePoint);
	const parent = new Map(hunks.map((hunk) => [hunk.id, hunk.id]));
	const byFile = new Map(paths.map((path) => [path, hunks.filter((hunk) => hunk.file === path)]));
	const dependencies = new Map(paths.map((path) => [path, new Set<string>()]));
	const imports = definiteImportTargets(paths);

	const root = (id: string): string => {
		let current = id;

		while (parent.get(current) !== current) current = parent.get(current)!;

		return current;
	};

	const link = (a: string, b: string) => parent.set(root(b), root(a));

	const linkFiles = (a: string, b: string) => {
		const left = byFile.get(a)?.[0];
		const right = byFile.get(b)?.[0];

		if (left && right) link(left.id, right.id);
	};

	const dependency = (caller: string, definition: string) => {
		if (!byFile.has(caller) || !byFile.has(definition) || caller === definition) return;

		linkFiles(caller, definition);
		dependencies.get(caller)!.add(definition);
	};

	for (const file of byFile.values()) for (const hunk of file.slice(1)) link(file[0].id, hunk.id);

	const tests = paths.filter(isTestPath);

	if (tests.length) {
		const testPaths = new Set(tests);
		const sourcesByKey = new Map<string, string[]>();

		for (const path of paths) {
			if (testPaths.has(path)) continue;

			const key = testSourceKey(path);
			const sources = sourcesByKey.get(key);

			if (sources) sources.push(path);
			else sourcesByKey.set(key, [path]);
		}

		for (const path of tests) {
			for (const source of sourcesByKey.get(testSourceKey(path)) ?? []) dependency(path, source);
		}
	}

	for (const symbol of model?.symbols ?? []) {
		for (const reference of symbol.references) dependency(reference.file, symbol.file);
		for (const test of symbol.tests) dependency(test, symbol.file);
	}

	for (const move of inventory.moves ?? []) linkFiles(move.fromPath, move.toPath);

	const identifiers = new Map<string, string[]>();

	for (const hunk of hunks) {
		const ref = inventory.hunksById.get(hunk.id);
		const file = inventory.diffs.find((file) => file.path === hunk.file);
		const patch = ref && file?.hunks[ref.file.hunks.indexOf(ref.hunk)];
		const text = patch?.lines.map((line) => line.text).join('\n') ?? '';

		for (const match of text.matchAll(/\b(?:from|import|require)\s*(?:\(\s*)?['"]([^'"]+)['"]/g)) {
			for (const path of imports(hunk.file, match[1])) dependency(hunk.file, path);
		}

		const changed =
			patch?.lines
				.filter((line) => line.type !== 'context')
				.map((line) => line.text)
				.join('\n') ?? '';

		for (const name of new Set(changed.match(/\b[A-Za-z_$][\w$]{3,}\b/g) ?? [])) {
			if (COMMON.has(name)) continue;

			const ids = identifiers.get(name) ?? [];

			if (ids.length <= 10) ids.push(hunk.id);
			identifiers.set(name, ids);
		}
	}

	for (const ids of identifiers.values()) {
		if (ids.length > 10) continue;

		for (const id of ids.slice(1)) link(ids[0], id);
	}

	const ordered: string[] = [];
	const phases = [new Set<string>(), new Set<string>(), new Set<string>()] as const;

	for (const path of paths) phases[rank(inventory, path)].add(path);

	for (const phase of phases) {
		while (phase.size) {
			const path = nextInPhase(phase, dependencies);

			phase.delete(path);
			ordered.push(path);
		}
	}

	const groups = new Map<string, DiffGuideHunk[]>();

	for (const path of ordered)
		for (const hunk of byFile.get(path)!) {
			const id = root(hunk.id);

			groups.set(id, [...(groups.get(id) ?? []), hunk]);
		}

	return {
		source: 'deterministic',
		groups: [...groups.values()].map((hunks, index) => ({
			id: `seed-${index + 1}`,
			title: unitTitle([...new Set(hunks.map((hunk) => hunk.file))].map((path) => ({ path, hunkIds: [] }))),
			hunks
		}))
	};
}
