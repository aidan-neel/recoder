import { BROAD_ERRORS, boundOf, errorClass, expectedError, instanceCheck, matcherKey } from './assertion-checks.js';
import { clip, type AddedLines } from './changed-lines.js';
import type { TestFileVersions } from './test-files.js';
import { testBlocks, type Assertion, type TestBlock } from './test-source.js';
import type { DetectorResult } from './types.js';

/** An assertion in a new test that looks like it proves less than the test claims. */
interface Suspicion {
	title: string;
	body: string;
}

/** Subclasses of a broad error class that the change adds, by the broad class they extend. */
export type AddedSubclasses = Map<string, string[]>;

const SUBCLASS = /\bclass\s+([A-Z]\w*)\s+extends\s+([A-Z]\w*)/g;

/** A subject that counts something: `.length`, `.size`, or a name ending in count, calls, attempts or times. */
const COUNT_SUBJECT = /(?:\.length|\.size|count|calls|attempts|times)$/i;

const EVERY_TITLE = /\b(?:every|all|each)\b/i;

/** `const error = await t.throwsAsync(…)`: the value is the thrown error, so it is always truthy. */
const THROWN_BINDING = /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?t\.throws(?:Async)?\s*\(/g;

/** Matchers that only check a value is there. */
const PRESENCE_MATCHERS = new Set([
	'truthy',
	'ok',
	'',
	'toBeTruthy',
	'toBeDefined',
	'not.toBeUndefined',
	'not.toBeNull'
]);

/** A subject that holds what a command printed or logged. */
const OUTPUT_SUBJECT = /(?:writes|stdout|stderr|output|lines|logs|messages)\b/i;

/** Words in a test title that promise a message reaches the user. */
const REPORT_TITLE = /\b(?:reports?|prints?|shows?|warns?|logs?|says?|displays?)\b/i;

/** Words in a test title that promise a choice among several items. */
const SELECT_TITLE = /\b(?:most|least|highest|lowest|first|last|newest|oldest|preferred|wins|keeps|prefers)\b/i;

/** Assertions that only count: `toHaveLength`, `.length`, `.size`. */
function countsOnly(assertion: Assertion): boolean {
	return matcherKey(assertion) === 'toHaveLength' || COUNT_SUBJECT.test(assertion.args[0] ?? '');
}

/** An assertion that looks at which item came back, not how many. */
function namesItem(assertion: Assertion): boolean {
	return (
		/^(?:toEqual|toStrictEqual|toContain|toContainEqual|toMatchObject|deepEqual|deepStrictEqual)$/.test(
			assertion.method
		) || /\[\d+\]|\.at\(|\.map\(|\.find\(/.test(assertion.args[0] ?? '')
	);
}

/** A test that says it reports something but only checks that the output is not empty. */
function outputPresence(test: TestBlock, assertion: Assertion): Suspicion | null {
	const found = boundOf(assertion);
	const subject = found?.subject.replace(/\.length$/, '') ?? '';

	if (!found || found.bound !== '0' || !OUTPUT_SUBJECT.test(subject) || !REPORT_TITLE.test(test.name)) return null;

	return {
		title: 'checks only that something was printed',
		body: `The test asserts \`${clip(assertion.text, 60)}\`, which passes for any output at all, not the message the title promises.`
	};
}

/** A test that says it keeps or picks one item but only checks how many came back. */
function keepsOneOfMany(test: TestBlock): Suspicion | null {
	if (!SELECT_TITLE.test(test.name) || !test.assertions.some(countsOnly) || test.assertions.some(namesItem))
		return null;

	return {
		title: 'checks how many items remain, not which one',
		body: 'The title promises a choice among items, but no assertion looks at which item is left, so keeping the wrong item passes.'
	};
}

/** A count checked only from below at this point in the test. */
function lowerBound(assertion: Assertion): Suspicion | null {
	const found = boundOf(assertion);

	if (!found || !COUNT_SUBJECT.test(found.subject)) return null;

	const { subject, op, bound } = found;

	return {
		title: `checks \`${clip(subject, 40)}\` only from below`,
		body: `The test asserts \`${clip(subject, 60)} ${op} ${bound}\`, so any larger count also passes. If the behavior the test names needs an exact count, a wrong one above the bound goes unnoticed.`
	};
}

/** `.some(` in a test whose title promises every item. */
function someForEvery(test: TestBlock, assertion: Assertion): Suspicion | null {
	if (!EVERY_TITLE.test(test.name) || !assertion.text.includes('.some(')) return null;

	return {
		title: 'checks only some items',
		body: "The test's title is about every item, but `.some` passes when a single item matches."
	};
}

/** Only a presence check on the error a throw assertion returned, which can never fail. */
function presenceOfThrown(test: TestBlock, assertion: Assertion, thrown: Set<string>): Suspicion | null {
	const subject = assertion.args[0] ?? '';

	if (!thrown.has(subject) || !PRESENCE_MATCHERS.has(matcherKey(assertion))) return null;
	if (test.assertions.some((other) => expectedError(other))) return null;

	const mentions = new RegExp(`^${subject}\\b`);

	if (test.assertions.some((other) => other !== assertion && mentions.test(other.args[0] ?? ''))) return null;

	return {
		title: 'never checks which error is thrown',
		body: `\`${subject}\` is the error \`t.throws\` already required, so \`${clip(assertion.text, 60)}\` cannot fail. Nothing checks its type or message, so any failure passes the test.`
	};
}

/** The error class a type or throw assertion requires, if it names one. */
function assertedClass(assertion: Assertion): string | null {
	return instanceCheck(assertion)?.name ?? errorClass(expectedError(assertion) ?? '');
}

/**
 * A broad error class asserted where the change adds a specific subclass of
 * it that no assertion in the test requires, unless the test is about the
 * broad class itself.
 */
function broadForSubclass(test: TestBlock, assertion: Assertion, subclasses: AddedSubclasses): Suspicion | null {
	const broad = assertedClass(assertion);
	const asserted = new Set(test.assertions.map(assertedClass));

	const specific =
		broad && !test.name.includes(broad) ? (subclasses.get(broad) ?? []).filter((name) => !asserted.has(name)) : [];

	if (!broad || !specific.length) return null;

	return {
		title: `accepts any \`${broad}\``,
		body: `This change adds \`${specific[0]}\`, a subclass of \`${broad}\`, but the test accepts any \`${broad}\`. It still passes if the code throws a different \`${broad}\` that carries the same fields.`
	};
}

/** Subclasses of broad error classes declared on the lines the change adds. */
export function addedSubclasses(added: AddedLines): AddedSubclasses {
	const found: AddedSubclasses = new Map();

	for (const lines of added.values()) {
		for (const text of lines.values()) {
			for (const [, name, parent] of text.matchAll(SUBCLASS)) {
				if (BROAD_ERRORS.has(parent!)) found.set(parent!, [...(found.get(parent!) ?? []), name!]);
			}
		}
	}

	return found;
}

/** The first suspicious assertion the test adds, as a result on its line. */
export function suspicionIn(file: TestFileVersions, test: TestBlock, subclasses: AddedSubclasses): DetectorResult[] {
	const thrown = new Set([...test.body.matchAll(THROWN_BINDING)].map((match) => match[1]!));

	for (const assertion of test.assertions) {
		if (!file.added.has(assertion.startLine)) continue;

		const found =
			outputPresence(test, assertion) ??
			(countsOnly(assertion) ? keepsOneOfMany(test) : null) ??
			lowerBound(assertion) ??
			someForEvery(test, assertion) ??
			presenceOfThrown(test, assertion, thrown) ??
			broadForSubclass(test, assertion, subclasses);

		if (!found) continue;

		return [
			{
				detector: 'weak-new-tests',
				category: 'tests',
				title: `\`${clip(test.name, 60)}\` ${found.title}`,
				body: found.body,
				file: file.path,
				line: assertion.startLine,
				endLine: assertion.endLine,
				evidence: `PR head: ${clip(assertion.text, 200)}`,
				suspected: true
			}
		];
	}

	return [];
}

/**
 * Weak assertions in the tests a change adds, which have no older version to
 * compare against. Each is a suspicion, not a proof: a verifier breaks the
 * behavior the test names and checks whether the test still passes.
 */
export function weakInNewTests(file: TestFileVersions, subclasses: AddedSubclasses): DetectorResult[] {
	const base = testBlocks(file.base);

	return [...testBlocks(file.head)].flatMap(([name, test]) =>
		base.has(name) ? [] : suspicionIn(file, test, subclasses)
	);
}
