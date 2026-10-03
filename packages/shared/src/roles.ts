/**
 * The specialized review lenses. The orchestrator assigns a bounded subset per review, and an
 * assignment's identity is never the role id. Each role can route to its own model.
 */
export const REVIEW_ROLES = [
	'security',
	'perf',
	'correctness',
	'docs',
	'dedup',
	'patterns',
	'testing',
	'errors',
	'concurrency',
	'api',
	'impact',
	'frontend',
	'data'
] as const;

export type ReviewRole = (typeof REVIEW_ROLES)[number];

/** Short display labels for role ids. */
export const ROLE_LABELS: Record<ReviewRole, string> = {
	security: 'Security',
	perf: 'Perf',
	correctness: 'Correctness',
	docs: 'Docs',
	dedup: 'Dedup',
	patterns: 'Repository consistency',
	testing: 'Testing',
	errors: 'Errors',
	concurrency: 'Concurrency',
	api: 'API',
	impact: 'Impact',
	frontend: 'Frontend',
	data: 'Data & state'
};
