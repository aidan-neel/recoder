import { describe, expect, test } from 'bun:test';
import { MAX_MUTANTS, mutantsOf, probeOf, type Mutant } from '../../../../src/review/pipeline/mutation/mutants';

function added(lines: number[]): Map<string, Map<number, string>> {
	return new Map([['src/a.ts', new Map(lines.map((line) => [line, '']))]]);
}

/** The whole file a probe mutant carries, failing the test when the probe is not one. */
function probeText(probe: Mutant | 'type' | null): string {
	if (!probe || typeof probe === 'string') throw new Error(`expected a probe mutant, got ${probe}`);

	return probe.text;
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
		const probe = await probeOf('src/a.ts', head, { line: 3, column: 2 });

		expect(probe).toMatchObject({ line: 2 });
		expect(probeText(probe).split('\n')[1]).toBe("\tthrow new Error('recoder-probe'); return g(");
	});

	test('probes module level code like any other statement', async () => {
		const probe = await probeOf('src/a.ts', head, { line: 6, column: 0 });

		expect(probe).toMatchObject({ line: 6 });
		expect(probeText(probe).split('\n')[5]).toBe("throw new Error('recoder-probe'); export const x = 1;");
	});

	test('does not probe types', async () => {
		expect(await probeOf('src/a.ts', 'interface A {\n\tb: number;\n}', { line: 2, column: 1 })).toBe('type');
	});

	test('returns null for a path no grammar covers', async () => {
		expect(await probeOf('src/a.xyz', head, { line: 3, column: 2 })).toBeNull();
	});

	test('starts the walk at the mutated token, not the start of the line', async () => {
		const oneLine = 'export const pick = (n: number) => { if (n > 0) return 1; return 0; };';
		const probe = await probeOf('src/a.ts', oneLine, { line: 1, column: 43 });

		expect(probe).toMatchObject({ line: 1 });
		expect(probeText(probe)).toContain("=> { throw new Error('recoder-probe'); if (n > 0)");
	});

	test('probes before the whole conditional chain for a mutant in an else-if branch', async () => {
		const chain = [
			'export function grade(score: number) {',
			'\tif (score >= 90) return "A";',
			'\telse if (score >= 80) return "B";',
			'\treturn "F";',
			'}'
		].join('\n');

		const probe = await probeOf('src/a.ts', chain, { line: 3, column: 16 });

		expect(probe).toMatchObject({ line: 2 });
		expect(probeText(probe).split('\n')[1]).toBe('\tthrow new Error(\'recoder-probe\'); if (score >= 90) return "A";');
	});
});
