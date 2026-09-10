/**
 * Reviewer role registry (leaf module — no imports, safe to require anywhere).
 *
 * Ten specialized lenses. The orchestrator assigns a bounded subset per
 * review; assignment identity is never the role id.
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
	'api'
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
	api: 'API'
};

/** What each lens hunts. Fed to the planner and specialists. */
export const ROLE_FOCUS: Record<ReviewRole, string> = {
	security:
		'Trust boundaries, auth/authz, injection, secret leaks, tenant isolation, unsafe deserialization, SSRF, path traversal.',
	perf: 'Algorithmic complexity, unbounded growth, N+1 patterns, wasteful allocation on hot paths, missing caching/eviction.',
	correctness:
		'Logic errors, off-by-ones, broken invariants, error handling, concurrency/race issues, dead or contradictory code.',
	docs: 'Stale comments, misleading names, missing docs for public behavior, comments that contradict the code.',
	dedup:
		'Duplicated logic across the diff and the surrounding code: copy-pasted blocks, parallel implementations of the same idea, helpers that already exist elsewhere and should be reused.',
	patterns:
	'Repo conventions and idioms: does the change match how this codebase already does things (naming, structure, error style, state handling)? Flag code that fights the local grain, even when it would be fine elsewhere.',
	testing:
	'Test coverage for the change: untested branches, weak assertions, tests that cannot fail, missing edge cases, untestable structure.',
	errors:
	'Failure behavior: swallowed errors, unhandled rejections, missing retries/timeouts, leaked resources on failure paths, misleading error messages.',
	concurrency:
	'Shared mutable state, races, lock discipline, async interleavings, non-atomic check-then-act, ordering assumptions across threads/tasks.',
	api: 'Interface design: signatures, naming, boundaries, leaky abstractions, backwards compatibility, surprising defaults.'
};
