import { describe, expect, test } from 'bun:test';
import { MAX_MUTANTS, mutantsOf, probeOf } from '../../../../src/review/pipeline/mutation/mutants';

function added(lines: number[]): Map<string, Map<number, string>> {
	return new Map([['src/a.ts', new Map(lines.map((line) => [line, '']))]]);
}

describe('mutantsOf', () => {
	test('mutates only the lines the change adds', () => {
		const head = ['if (a >= 1) return 0;', 'const x = b === c;'].join('\n');
		const found = mutantsOf('src/a.ts', head, added([2]));

		expect(found).toHaveLength(1);
		expect(found[0]?.text).toBe('if (a >= 1) return 0;\nconst x = b !== c;');
	});

	test('forces a guard to false and drops an await', () => {
		const head = ['if (items.length > 0) {', '\tconst r = await load();'].join('\n');
		const texts = mutantsOf('src/a.ts', head, added([1, 2])).map((mutant) => mutant.text);

		expect(texts).toContain('if (false) {\n\tconst r = await load();');
		expect(texts).toContain('if (items.length > 0) {\n\tconst r = load();');
	});

	test('skips comments and imports, and caps the count', () => {
		const head = [
			'// a >= b',
			"import x from './x';",
			...Array.from({ length: 20 }, (_, i) => `const v${i} = ${i + 5};`)
		].join('\n');

		const found = mutantsOf('src/a.ts', head, added(Array.from({ length: 22 }, (_, i) => i + 1)));

		expect(found).toHaveLength(MAX_MUTANTS);
		expect(found.every((mutant) => mutant.line > 2)).toBe(true);
	});
});

describe('probeOf', () => {
	const head = ['export function f(a: number) {', '\treturn g(', '\t\ta + 1', '\t);', '}', 'export const x = 1;'].join(
		'\n'
	);

	test('puts the throw before the statement that holds the line, not inside the expression', async () => {
		const probe = await probeOf('src/a.ts', head, 3);

		expect(probe).toMatchObject({ line: 2 });
		expect((probe as { text: string }).text.split('\n')[1]).toBe("\tthrow new Error('recoder-probe'); return g(");
	});

	test('does not probe module level code or types', async () => {
		expect(await probeOf('src/a.ts', head, 6)).toBe('module');
		expect(await probeOf('src/a.ts', 'interface A {\n\tb: number;\n}', 2)).toBe('type');
	});
});
