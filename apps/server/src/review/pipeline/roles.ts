import { REVIEW_ROLES, ROLE_LABELS, type ReviewRole } from '@recoder/shared';

/**
 * Review lens prompts and name resolution. The role list and labels live in `@recoder/shared`
 * and are re-exported here; this module imports nothing else, so anything can use it.
 */
export { REVIEW_ROLES, ROLE_LABELS, type ReviewRole };

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
	api: 'Interface design: signatures, naming, boundaries, leaky abstractions, backwards compatibility, surprising defaults.',
	impact:
		'Blast radius outside the diff: every caller, importer and consumer of a changed or removed symbol, route, event, config key or file. Find each one by search and check it still works with the new behavior.',
	frontend:
		'UI behavior: reactive state that goes stale or loops, effects without cleanup, event handlers and races between user actions and async results, missing loading/empty/error states, focus and keyboard access, layout that breaks at other sizes.',
	data: 'Persistent and shared state: storage formats, migrations, serialization, caches and their invalidation, settings or data written by older versions, state that must survive a restart or reload, and partial writes on failure.'
};

/** Words models and developers use for a role, mapped to its id. */
const ROLE_ALIASES: Record<string, ReviewRole> = {
	bug: 'correctness',
	bugs: 'correctness',
	logic: 'correctness',
	correct: 'correctness',
	behavior: 'correctness',
	behaviour: 'correctness',
	performance: 'perf',
	speed: 'perf',
	efficiency: 'perf',
	documentation: 'docs',
	comments: 'docs',
	doc: 'docs',
	duplication: 'dedup',
	duplicate: 'dedup',
	duplicates: 'dedup',
	reuse: 'dedup',
	conventions: 'patterns',
	convention: 'patterns',
	consistency: 'patterns',
	style: 'patterns',
	idioms: 'patterns',
	repository_consistency: 'patterns',
	repo_consistency: 'patterns',
	tests: 'testing',
	test: 'testing',
	coverage: 'testing',
	test_coverage: 'testing',
	error: 'errors',
	error_handling: 'errors',
	exceptions: 'errors',
	failures: 'errors',
	failure: 'errors',
	resilience: 'errors',
	races: 'concurrency',
	race: 'concurrency',
	threading: 'concurrency',
	async: 'concurrency',
	concurrent: 'concurrency',
	interface: 'api',
	interfaces: 'api',
	compatibility: 'api',
	api_design: 'api',
	blast_radius: 'impact',
	callers: 'impact',
	consumers: 'impact',
	ui: 'frontend',
	front_end: 'frontend',
	svelte: 'frontend',
	react: 'frontend',
	database: 'data',
	storage: 'data',
	migrations: 'data',
	persistence: 'data',
	state: 'data',
	data_state: 'data',
	sec: 'security',
	vulnerabilities: 'security',
	vulnerability: 'security',
	auth: 'security'
};

/** "Security", "error-handling", "Repository consistency" → the role id; null when it is none of them. */
export function resolveRole(raw: string): ReviewRole | null {
	const key = raw
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, '_')
		.replace(/[^a-z_&]/g, '');

	if ((REVIEW_ROLES as readonly string[]).includes(key)) return key as ReviewRole;
	if (ROLE_ALIASES[key]) return ROLE_ALIASES[key];

	const label = (Object.keys(ROLE_LABELS) as ReviewRole[]).find(
		(role) =>
			ROLE_LABELS[role]
				.toLowerCase()
				.replace(/[\s-]+/g, '_')
				.replace(/[^a-z_&]/g, '') === key
	);

	return label ?? null;
}
