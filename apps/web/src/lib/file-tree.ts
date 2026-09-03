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

/** Static stand-in for the session's changed-files tree. API-backed later. */
export const changedFiles: TreeNode[] = [
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
];

export const changedFileCount = 6;
