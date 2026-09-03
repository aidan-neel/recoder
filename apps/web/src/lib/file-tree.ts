export type FindingKind = 'error' | 'warning' | 'info';

export type TreeNode =
	| { kind: 'folder'; name: string; children: TreeNode[] }
	| {
			kind: 'file';
			id: string;
			name: string;
			additions: number;
			deletions: number;
			finding?: FindingKind;
	  };

export const FINDING_DOT: Record<FindingKind, string> = {
	error: '#e0655f',
	warning: '#d9a13b',
	info: '#5b8cff'
};

/** Folders first, then files; alphabetical (case-insensitive) within each group. */
export function sortTreeNodes(nodes: TreeNode[]): TreeNode[] {
	return [...nodes]
		.map((node) =>
			node.kind === 'folder' ? { ...node, children: sortTreeNodes(node.children) } : node
		)
		.sort((a, b) => {
			if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
			return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
		});
}

/** Static stand-in for the session's changed-files tree. API-backed later. */
export const changedFiles: TreeNode[] = sortTreeNodes([
	{
		kind: 'folder',
		name: 'src',
		children: [
			{
				kind: 'folder',
				name: 'rate-limit',
				children: [
					{
						kind: 'file',
						id: 'src/rate-limit/limiter.ts',
						name: 'limiter.ts',
						additions: 38,
						deletions: 21,
						finding: 'error'
					},
					{
						kind: 'file',
						id: 'src/rate-limit/index.ts',
						name: 'index.ts',
						additions: 4,
						deletions: 2,
						finding: 'warning'
					},
					{ kind: 'file', id: 'src/rate-limit/quota.ts', name: 'quota.ts', additions: 1, deletions: 0 }
				]
			},
			{
				kind: 'folder',
				name: 'gateway',
				children: [
					{
						kind: 'file',
						id: 'src/gateway/gateway.ts',
						name: 'gateway.ts',
						additions: 2,
						deletions: 2,
						finding: 'info'
					}
				]
			},
			{
				kind: 'folder',
				name: 'time',
				children: [
					{ kind: 'file', id: 'src/time/clock.ts', name: 'clock.ts', additions: 6, deletions: 0 }
				]
			}
		]
	},
	{
		kind: 'folder',
		name: 'test',
		children: [
			{
				kind: 'file',
				id: 'test/limiter.test.ts',
				name: 'limiter.test.ts',
				additions: 22,
				deletions: 9
			}
		]
	}
]);

export const changedFileCount = 6;

/** Build a folder tree from flat file paths (e.g. live review FileDiffs). */
export function buildFileTree(
	files: { path: string; additions: number; deletions: number }[]
): TreeNode[] {
	interface FolderEntry {
		name: string;
		children: Map<string, FolderEntry | FileEntry>;
	}
	interface FileEntry {
		name: string;
		fullPath: string;
		additions: number;
		deletions: number;
	}
	const root = new Map<string, FolderEntry | FileEntry>();

	for (const file of files) {
		const parts = file.path.split('/').filter(Boolean);
		if (parts.length === 0) continue;
		let level = root;
		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			const last = i === parts.length - 1;
			if (last) {
				level.set(part, {
					name: part,
					fullPath: file.path,
					additions: file.additions,
					deletions: file.deletions
				} satisfies FileEntry);
			} else {
				let folder = level.get(part) as FolderEntry | undefined;
				if (!folder || !('children' in folder)) {
					folder = { name: part, children: new Map() };
					level.set(part, folder);
				}
				level = folder.children;
			}
		}
	}

	const toNode = (entry: FolderEntry | FileEntry): TreeNode => {
		if ('children' in entry) {
			return {
				kind: 'folder',
				name: entry.name,
				children: [...entry.children.values()].map(toNode)
			};
		}
		const name = entry.name.split('/').pop() ?? entry.name;
		return {
			kind: 'file',
			id: entry.fullPath,
			name,
			additions: entry.additions,
			deletions: entry.deletions
		};
	};
	return sortTreeNodes([...root.values()].map(toNode));
}
