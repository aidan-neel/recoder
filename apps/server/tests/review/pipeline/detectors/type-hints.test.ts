import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { typeHintResults } from '../../../../src/review/pipeline/detectors/type-hints';

const roots: string[] = [];

function checkout(source: string): string {
	const root = mkdtempSync(join(tmpdir(), 'hints-'));

	roots.push(root);
	mkdirSync(join(root, 'src'));

	writeFileSync(
		join(root, 'tsconfig.json'),
		JSON.stringify({ compilerOptions: { strict: true, target: 'es2022' }, include: ['src'] })
	);

	writeFileSync(join(root, 'src/a.ts'), source);

	return root;
}

function allLines(source: string): Map<string, Map<number, string>> {
	return new Map([['src/a.ts', new Map(source.split('\n').map((text, index) => [index + 1, text]))]]);
}

afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('type hints', () => {
	test('flags a dropped promise but not an awaited, voided or caught one', () => {
		const source = [
			'async function load(): Promise<number> { return 1; }',
			'export async function run() {',
			'\tload();',
			'\tawait load();',
			'\tvoid load();',
			'\tload().catch(() => 0);',
			'}'
		].join('\n');

		const found = typeHintResults(checkout(source), allLines(source));

		expect(found.map((result) => [result.ruleId, result.line])).toEqual([['floating-promise', 3]]);
		expect(found[0]?.suspected).toBe(true);
	});

	test('names the members a default-less switch misses', () => {
		const source = [
			"type Kind = 'a' | 'b' | 'c';",
			'export function f(kind: Kind): number {',
			'\tswitch (kind) {',
			"\t\tcase 'a':",
			'\t\t\treturn 1;',
			"\t\tcase 'b':",
			'\t\t\treturn 2;',
			'\t}',
			'\treturn 0;',
			'}'
		].join('\n');

		const found = typeHintResults(checkout(source), allLines(source));

		expect(found).toHaveLength(1);
		expect(found[0]?.evidence).toContain('"c"');
	});

	test('ignores lines the change does not add', () => {
		const source = 'async function load() { return 1; }\nexport async function run() {\n\tload();\n}';

		expect(typeHintResults(checkout(source), new Map([['src/a.ts', new Map([[1, 'x']])]]))).toEqual([]);
	});

	test('does not read a file a symlink points outside the checkout', () => {
		const source = "import { secret } from './link';\nexport const x = secret;";
		const root = checkout(source);
		const outside = mkdtempSync(join(tmpdir(), 'outside-'));

		roots.push(outside);
		writeFileSync(join(outside, 'link.ts'), 'export async function secret() { return 1; }\nsecret();');
		symlinkSync(join(outside, 'link.ts'), join(root, 'src/link.ts'));

		expect(typeHintResults(root, allLines(source))).toEqual([]);
	});
});
