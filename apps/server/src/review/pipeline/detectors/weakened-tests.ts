import {
	BROAD_ERRORS,
	EXACT_MATCHERS,
	LOOSE_MATCHERS,
	errorClass,
	expectedError,
	instanceCheck,
	matcherKey
} from './assertion-checks.js';
import { clip } from './changed-lines.js';
import type { TestFileVersions } from './test-files.js';
import { testBlocks, type Assertion, type TestBlock } from './test-source.js';
import type { DetectorResult } from './types.js';

/** A change that makes a test accept more than before. */
interface Weakness {
	title: string;
	body: string;
}

const TYPE_CHECK = /toBeInstanceOf\s*\(|\binstanceof\b|\.name\b[^;]*['"`]\w*(?:Error|Exception)['"`]/;

const ERROR_NAME = /\b[A-Z]\w*(?:Error|Exception)\b/;

/** `items` minus the entries `others` also has, comparing assertion text and honoring repeats. */
function without(items: Assertion[], others: Assertion[]): Assertion[] {
	const remaining = [...others];

	return items.filter((item) => {
		const at = remaining.findIndex((other) => other.text === item.text);

		if (at < 0) return true;

		remaining.splice(at, 1);

		return false;
	});
}

/** A throw assertion that lost its expected error, or now names a broad class where it named a specific one. */
function throwWeakness(before: Assertion, after: Assertion, head: string): Weakness | null {
	const was = expectedError(before);
	const now = expectedError(after);

	if (was === null || now === null || before.family !== after.family) return null;

	if (was && !now) {
		return {
			title: 'no longer checks which error is thrown',
			body: `The old assertion required a specific error (\`${clip(was, 80)}\`). The new one passes for any error, so a different failure now satisfies the test.`
		};
	}

	return broadened(errorClass(was), errorClass(now), head);
}

/** A specific error class swapped for a broad one, when nothing else in the test still names the specific one. */
function broadened(oldClass: string | null, newClass: string | null, head: string): Weakness | null {
	if (!oldClass || !newClass || oldClass === newClass) return null;
	if (!BROAD_ERRORS.has(newClass) || BROAD_ERRORS.has(oldClass) || head.includes(oldClass)) return null;

	return {
		title: 'now accepts a broader error',
		body: `The old assertion required \`${oldClass}\`. The new one accepts \`${newClass}\`, which also matches errors the old one rejected, and nothing else in the test asserts \`${oldClass}\`.`
	};
}

/** An instance check on the same value that now names a broad class where it named a specific one. */
function instanceWeakness(before: Assertion, after: Assertion, head: string): Weakness | null {
	const was = instanceCheck(before);
	const now = instanceCheck(after);

	return was && now && was.subject === now.subject ? broadened(was.name, now.name, head) : null;
}

/** An exact comparison of a value replaced by a check that many other values also pass. */
function exactWeakness(before: Assertion, after: Assertion): Weakness | null {
	if (!EXACT_MATCHERS.has(matcherKey(before)) || !LOOSE_MATCHERS.has(matcherKey(after))) return null;

	return {
		title: 'no longer checks the exact value',
		body: `The old assertion pinned the value exactly (\`${before.method}\`). The new \`${matcherKey(after)}\` passes for any value that is merely truthy, in range or contained, so a wrong value can slip through.`
	};
}

function weakness(before: Assertion, after: Assertion, head: string): Weakness | null {
	return throwWeakness(before, after, head) ?? exactWeakness(before, after);
}

/** A new assertion that is the old one with `.every(` swapped for `.some(`. */
function everyToSome(before: Assertion, after: Assertion): boolean {
	return before.text.includes('.every(') && before.text.replaceAll('.every(', '.some(') === after.text;
}

function isTypeCheck(assertion: Assertion): boolean {
	return TYPE_CHECK.test(assertion.text);
}

/** The first added line in the span, or the first line the diff shows when it only deletes. */
function anchor(file: TestFileVersions, from: number, to: number, onlyAdded: boolean): number | null {
	for (let line = from; line <= to; line++) if (file.added.has(line)) return line;

	if (onlyAdded) return null;

	for (let line = from; line <= to; line++) if (file.visible.has(line)) return line;

	return null;
}

function result(
	file: TestFileVersions,
	test: TestBlock,
	line: number,
	found: Weakness,
	evidence: string
): DetectorResult {
	return {
		detector: 'weakened-tests',
		category: 'tests',
		title: `\`${clip(test.name, 60)}\` ${found.title}`,
		body: found.body,
		file: file.path,
		line,
		evidence
	};
}

function changedEvidence(before: Assertion, after: Assertion): string {
	return `Merge base: ${clip(before.text, 200)}\nPR head: ${clip(after.text, 200)}`;
}

/** A removed error-type check that nothing in the new test replaces or still mentions. */
function lostTypeCheck(gone: Assertion[], fresh: Assertion[], after: TestBlock): Assertion | undefined {
	if (fresh.some(isTypeCheck)) return undefined;

	return gone.find((assertion) => {
		if (!isTypeCheck(assertion)) return false;

		const name = ERROR_NAME.exec(assertion.text)?.[0];

		return name ? !after.body.includes(name) : !after.assertions.some(isTypeCheck);
	});
}

/** What an edited test lost outright: a removed error-type check, else a plain drop in the assertion count. */
function removalResults(
	file: TestFileVersions,
	before: TestBlock,
	after: TestBlock,
	gone: Assertion[],
	fresh: Assertion[]
): DetectorResult[] {
	const line = anchor(file, after.startLine, after.endLine, false);

	if (line === null) return [];

	const lost = lostTypeCheck(gone, fresh, after);

	if (lost) {
		return [
			result(
				file,
				after,
				line,
				{
					title: 'no longer checks the error type',
					body: 'The old test asserted the error was of a specific type or name. The test still runs but nothing in it checks that now, so any error passes.'
				},
				`Merge base: ${clip(lost.text, 200)}\nPR head: no assertion on that type in this test.`
			)
		];
	}

	if (before.assertions.length <= after.assertions.length) return [];

	const fewer = result(
		file,
		after,
		line,
		{
			title: 'has fewer assertions',
			body: `The old test made ${before.assertions.length} assertions and this one makes ${after.assertions.length}. Whatever the removed ones proved may no longer be checked.`
		},
		`Merge base: ${before.assertions.length} assertions\nPR head: ${after.assertions.length} assertions`
	);

	return [{ ...fewer, suspected: true }];
}

/** How an old assertion and a new one on the same subject differ, when the new one proves less. */
function pairWeakness(before: Assertion, after: Assertion, head: string): Weakness | null {
	if (everyToSome(before, after)) {
		return {
			title: 'now passes when only some items match',
			body: 'The old assertion used `every`, which needs all items to match. `some` passes when a single item does.'
		};
	}

	return (
		instanceWeakness(before, after, head) ?? (before.args[0] === after.args[0] ? weakness(before, after, head) : null)
	);
}

/** Each weakening between one test's two versions: paired assertions first, then what was removed. */
function compareTest(file: TestFileVersions, before: TestBlock, after: TestBlock): DetectorResult[] {
	const gone = without(before.assertions, after.assertions);
	const fresh = without(after.assertions, before.assertions);
	const results: DetectorResult[] = [];
	const used = new Set<Assertion>();

	for (const now of fresh) {
		const line = anchor(file, now.startLine, now.endLine, true);

		if (line === null) continue;

		for (const old of gone) {
			const found = used.has(old) ? null : pairWeakness(old, now, after.body);

			if (!found) continue;

			used.add(old);
			results.push(result(file, after, line, found, changedEvidence(old, now)));

			break;
		}
	}

	if (results.length) return results;

	return removalResults(
		file,
		before,
		after,
		gone.filter((old) => !used.has(old)),
		fresh
	);
}

/**
 * Assertions an edited test file makes weaker, found by comparing each test
 * (same title, same `describe` path) at the merge base and the PR head. Added,
 * deleted and renamed tests are not compared, nor are tests whose body is
 * unchanged. Results sit on the head side of the weakened assertion.
 */
export function weakenedInFile(file: TestFileVersions): DetectorResult[] {
	const base = testBlocks(file.base);

	return [...testBlocks(file.head)].flatMap(([name, after]) => {
		const before = base.get(name);

		return before && before.body !== after.body ? compareTest(file, before, after) : [];
	});
}
