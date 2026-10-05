import { READABILITY_SMELLS } from '@recoder/shared';
import type { ReviewUnit } from '../units.js';
import type { Lens, LensId } from './types.js';

/** Turns a list of steps into the numbered procedure a lens prompt shows. */
function numbered(steps: string[]): string {
	return steps.map((step, index) => `${index + 1}. ${step}`).join('\n');
}

const CORRECTNESS: Lens = {
	id: 'correctness',
	title: 'Correctness',
	categories: ['correctness', 'error-handling', 'tests', 'intent-mismatch'],
	procedure: numbered([
		'State what the symbol must do, from its name, signature, callers, tests and the change intent.',
		'Walk every branch with empty, null, zero, boundary and maximum inputs. A wrong result, crash or lost value is correctness.',
		'Follow every call that can fail (I/O, parsing, network, awaits, model calls). A failure that is unhandled, swallowed, reported wrongly, or skips cleanup is error-handling.',
		'For each changed expression, name the contract it must keep, then try the value that breaks it: rounding or truncation that drops a fraction or resets a counter, a default that treats 0 or an empty string as missing (|| where ?? is meant), < against <=, off-by-one slices and indexes, an empty or missing header, field or element, and the first, last and only item. Report the input and the wrong result.',
		'A guard, validation or type check the change removed or narrowed (Array.isArray, a null or empty test, a length cap, a required-field check) is correctness unless the same check still runs earlier. Message text the change edited must still name the true cause.',
		'Compare with the removed or replaced lines. A guarantee the old code gave that nothing gives now is correctness.',
		'Check each caller listed in the context against the new behavior: return values, nulls, thrown errors, ordering. A caller that now breaks is correctness.',
		'Check the acceptance criteria, stated constraints and non-goals in the change intent. One the code does not meet, or a non-goal it does anyway, is intent-mismatch; cite the claim id in violatedContract.',
		'Check the tests in this unit or listed for the symbol. A test that cannot fail, asserts the wrong thing, or misses the changed branch is tests.',
		'For each test the change adds or edits, state what its title promises, then break that promise in the code under test with one small edit and run the test. If it still passes, the test is weak (tests): cite the assertion that should be stricter, such as a bound where the title implies an exact value, or a step the title needs that the test never takes (concurrent calls, a repeat request that should hit the cache).'
	])
};

const SECURITY: Lens = {
	id: 'security',
	title: 'Security',
	categories: ['security'],
	procedure: numbered([
		'Name the untrusted inputs the symbol reads (request data, files, environment, PR text, model output, CLI output) and trace each to where it is used.',
		'Injection: input reaching a shell command, SQL, file path, HTML, regex or template without escaping or validation.',
		'Paths and symlinks that can escape their root, and files written with loose permissions.',
		'Authentication and authorization checks that are missing, run too late, or can be bypassed.',
		'Secrets or tokens that reach logs, error messages, URLs, prompts or responses.',
		'Unsafe evaluation or deserialization, prototype pollution, weak randomness for tokens, and non-constant-time secret comparison.',
		'Outbound requests to URLs the input controls (SSRF) and open redirects.'
	])
};

const CONCURRENCY: Lens = {
	id: 'concurrency',
	title: 'Concurrency and data',
	categories: ['concurrency', 'data-persistence'],
	procedure: numbered([
		'List the shared state the symbol reads or writes (module variables, caches, maps, files, database rows) and what else touches it.',
		'Look for an await or callback between a check and the use that relies on it, and for two overlapping calls that interleave badly. Either is concurrency.',
		'Promises that are not awaited, abort signals not passed on, timers or listeners not cleared, and unbounded parallel work are concurrency.',
		'Retries or re-entry that repeat a side effect (a write, a charge, a message) are concurrency.',
		'Writes that are not atomic, can be left half-done by a crash, or lose data on restart are data-persistence.',
		'A change to a saved format, schema or key without a version, migration, or a way to read what older runs saved is data-persistence.'
	])
};

const API_CONTRACT: Lens = {
	id: 'api-contract',
	title: 'API contract',
	categories: ['api-contract', 'intent-mismatch'],
	procedure: numbered([
		'For each exported or public symbol, compare the old and new signature, return shape, thrown errors and defaults.',
		'Check every reference listed in the context still holds against the new contract. A caller that now breaks or silently changes behavior is api-contract.',
		'Check wire formats the change touches: HTTP routes and bodies, JSON fields, events, CLI flags, environment and config keys. A rename, removal or retype without compatibility is api-contract.',
		'Types, docstrings or docs the change made wrong about behavior are api-contract.',
		'Check stated constraints in the change intent such as "backwards compatible" or "no behavior change". One the code breaks is intent-mismatch; cite the claim id.'
	])
};

const PERFORMANCE: Lens = {
	id: 'performance',
	title: 'Performance',
	categories: ['performance'],
	procedure: numbered([
		'Find the loops over input that can be large, and name how large it can get.',
		'Inside each loop, look for linear work (find, includes, filter, spread, string concatenation) that makes the whole quadratic.',
		'Repeated I/O, network or model calls that run once per item where one batched call would do.',
		'Caches, arrays, maps and listeners that grow without a bound or eviction.',
		'Synchronous blocking work (sync file system calls, large JSON parsing, heavy regex) on a request or event-loop path.',
		'Report only with a concrete input size the code can reach; never on a hunch.'
	])
};

const RULES: Lens = {
	id: 'rules',
	title: 'Repository rules',
	categories: ['repo-rule'],
	procedure: numbered([
		'Take the rule ledger rules that apply to this unit. When there are none, report nothing.',
		'For each changed symbol, check each rule in ledger order against the lines the change added or modified.',
		'Report each violation as repo-rule with its ruleId and the violating span (file, line, endLine). Quote the rule in violatedContract.',
		'Never cite a rule that is not in the ledger, and never report a span the change did not add or modify.'
	])
};

const CONVENTIONS: Lens = {
	id: 'conventions',
	title: 'Conventions',
	categories: ['convention', 'duplication', 'dead-code'],
	procedure: numbered([
		'For each changed symbol, read the comparable examples the context lists for it.',
		'When the change does something differently from two or more comparable examples that agree with each other (naming, placement, error pattern, helper use), report convention and cite those examples in "examples" as file and line. With fewer than two, or with a counter-example, report nothing.',
		'When added code repeats existing logic that could be imported instead, report duplication and cite the existing code in "examples".',
		'When the change adds or leaves behind an export, parameter, branch or file nothing references, report dead-code.',
		'Add "fix" edits when the fix is mechanical.'
	])
};

const READABILITY: Lens = {
	id: 'readability',
	title: 'Readability',
	categories: ['readability', 'complexity'],
	procedure: numbered([
		`For each changed symbol, check the smells in this order: ${READABILITY_SMELLS.join(', ')}.`,
		'deep-nesting and long-function are complexity; compare the symbol metrics with the repo baseline in the context and report only a clear outlier.',
		'Every other smell is readability. Name exactly one smell in "smell" per finding.',
		'Report only on lines the change added or modified, and only when a careful human reviewer on this repo would ask for the change.',
		'Add "fix" edits when the fix is mechanical (a rename, an extracted constant).'
	])
};

/** Every lens, in the order a unit runs them. */
export const LENSES: readonly Lens[] = [
	CORRECTNESS,
	SECURITY,
	CONCURRENCY,
	API_CONTRACT,
	PERFORMANCE,
	RULES,
	CONVENTIONS,
	READABILITY
];

/** Lenses that report maintainability, held to repo-grounded evidence rather than a bug's trigger and path. */
const QUALITY_LENSES: ReadonlySet<LensId> = new Set(['rules', 'conventions', 'readability']);

/** Lenses a docs-only unit runs: no code to break, but rules and clarity still apply. */
const DOCS_LENSES: ReadonlySet<LensId> = new Set(['rules', 'readability']);

const DOCS_FILE = /\.(?:md|mdx|markdown|rst|txt|adoc)$/i;

/** The lens with this id; every `LensId` has one. */
export function lensById(id: LensId): Lens {
	return LENSES.find((lens) => lens.id === id)!;
}

/** Whether a lens reports maintainability (rules, conventions, readability) rather than defects. */
export function isQualityLens(id: LensId): boolean {
	return QUALITY_LENSES.has(id);
}

/** The lenses that apply to a unit, in `LENSES` order: all of them, or rules and readability for docs only. */
function lensesFor(unit: ReviewUnit): Lens[] {
	const docsOnly = unit.scope.length > 0 && unit.scope.every((entry) => DOCS_FILE.test(entry.path));

	return docsOnly ? LENSES.filter((lens) => DOCS_LENSES.has(lens.id)) : [...LENSES];
}

/** One assignment per unit and applicable lens, unit by unit, each lens in order. */
export function lensAssignments(units: ReviewUnit[]): ReviewUnit[] {
	return units.flatMap((unit) =>
		lensesFor(unit).map((lens) => ({
			...unit,
			id: `${unit.id}/${lens.id}`,
			title: `${unit.title} · ${lens.title}`,
			reason: `Applies the ${lens.title.toLowerCase()} procedure to every changed symbol in ${unit.title}.`,
			lens: lens.id
		}))
	);
}
