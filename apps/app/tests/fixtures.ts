import type { AgentStatus, DiffHunk, Repo, ReviewListItem } from '@recoder/shared';

/** The head commit the fixtures' pull requests and reviews share. */
export const HEAD = 'head1';

/** A Map-backed stand-in for the browser's localStorage or sessionStorage. */
export function memoryStorage(): Storage {
	const items = new Map<string, string>();

	return {
		get length() {
			return items.size;
		},
		key: (index) => [...items.keys()][index] ?? null,
		getItem: (key) => items.get(key) ?? null,
		setItem: (key, value) => void items.set(key, value),
		removeItem: (key) => void items.delete(key),
		clear: () => items.clear()
	};
}

/** A hunk of `count` added lines on the new side, starting at line `start`. */
export function addedHunk(start: number, count: number): DiffHunk {
	return {
		header: `@@ -${start},0 +${start},${count} @@`,
		oldStart: start,
		oldCount: 0,
		newStart: start,
		newCount: count,
		lines: Array.from({ length: count }, (_, i) => ({ type: 'add' as const, oldNo: null, newNo: start + i, text: '' }))
	};
}

/** A finished review of pull request #7 in repo `r1` with no findings; `change` overrides any field. */
export function review(change: Partial<ReviewListItem> = {}): ReviewListItem {
	return {
		id: 'rv1',
		repoId: 'r1',
		prNumber: 7,
		headSha: HEAD,
		status: 'passed',
		summary: 'Fine.',
		prTitle: null,
		prUrl: null,
		createdAt: '',
		updatedAt: '',
		findings: [],
		...change
	};
}

/** A connected GitHub repo named `name` (`owner/repo`). */
export function tracked(id: string, name: string): Repo {
	return {
		id,
		name,
		url: `https://github.com/${name}`,
		provider: 'github',
		defaultBranch: 'main',
		createdAt: '',
		updatedAt: ''
	};
}

/** OpenCode installed and ready, with `patch` on top. */
export function openCodeStatus(patch: Partial<AgentStatus> = {}): AgentStatus {
	return {
		id: 'opencode',
		name: 'OpenCode',
		installed: true,
		version: '1.0.0',
		path: '/usr/bin/opencode',
		error: null,
		install: 'npm i -g opencode',
		signedIn: null,
		login: null,
		providers: true,
		config: null,
		setup: { install: false, signIn: false },
		...patch
	};
}
