import type { ObligationTrigger } from '@recoder/shared';
import { describe, expect, test } from 'bun:test';
import { deriveFrom, file } from './fixtures';

/** The triggers a change sets off on `path`, with the side and line of each. */
async function hits(change: ReturnType<typeof file>, path?: string): Promise<string[]> {
	const obligations = await deriveFrom(change.base, change.head);

	return obligations
		.filter((entry) => !path || entry.location.file === path)
		.map((entry) => `${entry.trigger} ${entry.location.side}:${entry.location.line}`);
}

function triggers(found: string[]): ObligationTrigger[] {
	return found.map((entry) => entry.split(' ')[0] as ObligationTrigger);
}

describe('truthy check or changed default', () => {
	const before = [
		'export function pageSize(limit?: number) {',
		'\tif (limit === undefined) return 20;',
		'\treturn limit;',
		'}'
	];

	test('a truthiness test that replaced an undefined check derives the obligation', async () => {
		const found = await hits(file('src/page.ts', before, [before[0], '\tif (!limit) return 20;', ...before.slice(2)]));

		expect(found).toContain('truthy-default new:2');
	});

	test('a nullish check in the same place does not', async () => {
		const found = await hits(
			file('src/page.ts', before, [before[0], '\tif (limit == null) return 20;', ...before.slice(2)])
		);

		expect(triggers(found)).not.toContain('truthy-default');
	});

	test('a default value that changed derives it', async () => {
		const found = await hits(
			file(
				'src/retry.ts',
				['export function retry(times = 3) {', '\treturn times;', '}'],
				['export function retry(times = 0) {', '\treturn times;', '}']
			)
		);

		expect(found).toContain('truthy-default new:1');
	});

	test('a default kept through a rename does not', async () => {
		const found = await hits(
			file(
				'src/retry.ts',
				['export function retry(times = 3) {', '\treturn times;', '}'],
				['export function retryAll(times = 3) {', '\treturn times;', '}']
			)
		);

		expect(triggers(found)).not.toContain('truthy-default');
	});
});

describe('rounding, division, comparison or limit', () => {
	const before = ['export function isFull(queue: string[], max: number) {', '\treturn queue.length > max;', '}'];

	test('a comparison with a limit whose operator changed derives the obligation', async () => {
		const found = await hits(file('src/queue.ts', before, [before[0], '\treturn queue.length >= max;', before[2]]));

		expect(found).toContain('boundary new:2');
	});

	test('rounding derives it', async () => {
		const found = await hits(
			file(
				'src/pages.ts',
				['export function pages(total: number, size: number) {', '\treturn total;', '}'],
				['export function pages(total: number, size: number) {', '\treturn Math.ceil(total / size);', '}']
			)
		);

		expect(found).toContain('boundary new:2');
	});

	test('an ordering comparison between two names that are not limits does not', async () => {
		const found = await hits(
			file(
				'src/sort.ts',
				['export const byName = (a: { name: string }, b: { name: string }) => (a.name > b.name ? 1 : -1);'],
				['export const byName = (a: { title: string }, b: { title: string }) => (a.title > b.title ? 1 : -1);']
			)
		);

		expect(triggers(found)).not.toContain('boundary');
	});
});

describe('removed input guard', () => {
	const before = [
		'export function load(path: string) {',
		"\tif (path.includes('..')) throw new Error('path escapes the root');",
		'\treturn read(path);',
		'}',
		'',
		'function read(path: string) {',
		'\treturn path;',
		'}'
	];

	test('a deleted early exit derives the obligation on the old side', async () => {
		const found = await hits(file('src/load.ts', before, [before[0], ...before.slice(2)]));

		expect(found).toContain('removed-guard old:2');
	});

	test('a guard moved into a helper does not', async () => {
		const found = await hits(
			file('src/load.ts', before, [
				'function check(path: string) {',
				"\tif (path.includes('..')) throw new Error('path escapes the root');",
				'}',
				'',
				'export function load(path: string) {',
				'\tcheck(path);',
				'\treturn read(path);',
				'}',
				...before.slice(4)
			])
		);

		expect(triggers(found)).not.toContain('removed-guard');
	});
});

describe('changed normalization', () => {
	const before = ['export function key(email: string) {', '\treturn email.trim().toLowerCase();', '}'];

	test('a dropped normalizer derives the obligation', async () => {
		const found = await hits(file('src/key.ts', before, [before[0], '\treturn email.trim();', before[2]]));

		expect(found).toContain('normalization old:2');
	});

	test('the same normalizers on a renamed variable do not', async () => {
		const found = await hits(
			file('src/key.ts', before, [
				'export function key(address: string) {',
				'\treturn address.trim().toLowerCase();',
				'}'
			])
		);

		expect(triggers(found)).not.toContain('normalization');
	});
});

describe('resource acquisition before a possible exception', () => {
	const before = [
		"import { closeSync, openSync, readFileSync, readSync } from 'node:fs';",
		'',
		'export function firstByte(path: string) {',
		'\treturn readFileSync(path)[0];',
		'}'
	];

	const open = ['\tconst fd = openSync(path, "r");', '\tconst buffer = Buffer.alloc(1);'];

	test('a handle opened before calls that can throw derives the obligation', async () => {
		const found = await hits(
			file('src/byte.ts', before, [
				...before.slice(0, 3),
				...open,
				'\treadSync(fd, buffer, 0, 1, 0);',
				'\tcloseSync(fd);',
				'\treturn buffer[0];',
				'}'
			])
		);

		expect(found).toContain('resource-release new:4');
	});

	test('the same handle released in a finally does not', async () => {
		const found = await hits(
			file('src/byte.ts', before, [
				...before.slice(0, 3),
				...open,
				'\ttry {',
				'\t\treadSync(fd, buffer, 0, 1, 0);',
				'\t} finally {',
				'\t\tcloseSync(fd);',
				'\t}',
				'\treturn buffer[0];',
				'}'
			])
		);

		expect(triggers(found)).not.toContain('resource-release');
	});
});

describe('numeric count or size validation', () => {
	const before = [
		'export function chunk<T>(items: T[], size: number): T[][] {',
		'\tconst out: T[][] = [];',
		'\tfor (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));',
		'\treturn out;',
		'}'
	];

	test('a new size check that throws derives the obligation', async () => {
		const found = await hits(
			file('src/chunk.ts', before, [
				before[0],
				"\tif (size < 1) throw new RangeError('size must be at least 1');",
				...before.slice(1)
			])
		);

		expect(found).toContain('count-validation new:2');
	});

	test('the same check on a value that is not a count does not', async () => {
		const scaled = before.map((line) => line.replaceAll('size', 'scale'));

		const found = await hits(
			file('src/chunk.ts', scaled, [
				scaled[0],
				"\tif (scale < 0.5) throw new RangeError('scale too small');",
				...scaled.slice(1)
			])
		);

		expect(triggers(found)).not.toContain('count-validation');
	});
});

describe('error text or command exit status', () => {
	const before = [
		'export function get(map: Map<string, number>, key: string) {',
		'\tconst value = map.get(key);',
		"\tif (value === undefined) throw new Error('not found');",
		'\treturn value;',
		'}'
	];

	test('changed error text derives the obligation', async () => {
		const found = await hits(
			file('src/get.ts', before, [
				...before.slice(0, 2),
				"\tif (value === undefined) throw new Error('missing key');",
				...before.slice(3)
			])
		);

		expect(found).toContain('error-contract new:3');
	});

	test('a changed exit status derives it', async () => {
		const found = await hits(
			file(
				'src/cli.ts',
				['export function fail() {', '\tprocess.exitCode = 1;', '}'],
				['export function fail() {', '\tprocess.exitCode = 2;', '}']
			)
		);

		expect(found).toContain('error-contract new:2');
	});

	test('the same error text in a reshaped branch does not', async () => {
		const found = await hits(
			file('src/get.ts', before, [
				...before.slice(0, 2),
				'\tif (value === undefined) {',
				"\t\tthrow new Error('not found');",
				'\t}',
				...before.slice(3)
			])
		);

		expect(triggers(found)).not.toContain('error-contract');
	});
});

describe('removed or weaker assertion', () => {
	const before = [
		"import { expect, test } from 'bun:test';",
		"import { sum } from '../src/sum';",
		'',
		"test('adds', () => {",
		'\texpect(sum(1, 2)).toBe(3);',
		'});'
	];

	test('an exact matcher swapped for a loose one derives the obligation', async () => {
		const found = await hits(
			file('tests/sum.test.ts', before, [...before.slice(0, 4), '\texpect(sum(1, 2)).toBeTruthy();', before[5]])
		);

		expect(found).toContain('weaker-assertion new:5');
	});

	test('a deleted assertion derives it on the old side', async () => {
		const found = await hits(file('tests/sum.test.ts', before, [...before.slice(0, 4), '\tsum(1, 2);', before[5]]));

		expect(found).toContain('weaker-assertion old:5');
	});

	test('an exact matcher swapped for another exact one does not', async () => {
		const found = await hits(
			file('tests/sum.test.ts', before, [...before.slice(0, 4), '\texpect(sum(1, 2)).toEqual(3);', before[5]])
		);

		expect(triggers(found)).not.toContain('weaker-assertion');
	});
});
