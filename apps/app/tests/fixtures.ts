import type {
	AgentStatus,
	DiffHunk,
	ModelSettings,
	PullListItem,
	PullStatus,
	Repo,
	ReviewListItem
} from '@recoder/shared';

/** The head commit the fixtures' pull requests and reviews share. */
const HEAD = 'head1';

/** Model settings with nothing picked or configured beyond the defaults, overridden by `patch`. */
export function modelSettings(patch: Partial<ModelSettings> = {}): ModelSettings {
	return {
		configured: true,
		baseUrl: '',
		model: '',
		apiKeySet: false,
		sharedModelId: null,
		models: [],
		subagentCap: 8,
		tokenBudget: 'medium',
		reportLowSeverity: true,
		disabledProviders: [],
		contextWindows: {},
		hiddenModels: [],
		modelPolicy: { kind: 'choose' },
		limits: { maxFiles: 20, maxDiffChars: 60_000, maxFileChars: 12_000 },
		...patch
	};
}

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

/** Open pull request #7 of repo `r1` at the fixtures' head, mergeable with passing checks and no review; `status` overrides its forge status. */
export function openPull(status: Partial<PullStatus> = {}): PullListItem {
	return {
		repoId: 'r1',
		pull: {
			number: 7,
			title: 'Change',
			url: 'https://github.com/acme/api/pull/7',
			author: 'ana',
			base: 'main',
			headRef: 'feature',
			headSha: HEAD,
			additions: 1,
			deletions: 1,
			changedFiles: 1,
			createdAt: ''
		},
		status: {
			state: 'open',
			draft: false,
			mergeability: 'clean',
			updatedAt: '2026-10-13T09:00:00.000Z',
			checks: { passed: 2, failed: 0, pending: 0 },
			commits: 1,
			...status
		},
		review: null
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
