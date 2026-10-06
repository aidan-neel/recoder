/** A base tree and the head tree committed on top of it. */
export interface FixtureCase {
	base: Record<string, string>;
	head: Record<string, string>;
}

const BASE_TS = [
	'export class Limiter {',
	'\tprivate count = 0;',
	'',
	'\ttake(n: number): boolean {',
	'\t\treturn this.count >= n;',
	'\t}',
	'',
	'\tdrop(): void {',
	'\t\tthis.count = 0;',
	'\t}',
	'}',
	'',
	'function helper(a: string) {',
	'\treturn a;',
	'}',
	''
].join('\n');

const HEAD_TS = [
	'export class Limiter {',
	'\tprivate count = 0;',
	'',
	'\ttake(n: number): boolean {',
	'\t\tif (n > 0) {',
	'\t\t\tthis.count += n;',
	'\t\t}',
	'',
	'\t\treturn this.count >= n;',
	'\t}',
	'}',
	'',
	'export const limit = (max: number, label: string) => {',
	'\treturn new Limiter().take(max);',
	'};',
	''
].join('\n');

const BASE_LIMITER = ['export function take(n: number): boolean {', '\treturn n > 0;', '}', ''].join('\n');

const HEAD_LIMITER = [
	'export function take(n: number, label: string): boolean {',
	'\treturn n > 0 && label.length > 0;',
	'}',
	''
].join('\n');

const UNCHANGED = {
	'src/use.ts': ["import { take } from './limiter';", '', 'export const ok = take(3);', ''].join('\n'),
	'src/bag.ts': [
		'export class Bag {',
		'\ttake(): number {',
		'\t\treturn 1;',
		'\t}',
		'}',
		'',
		'export const one = new Bag().take();',
		''
	].join('\n'),
	'src/notes.ts': ['// take the lock before writing', "export const label = 'take';", ''].join('\n'),
	'tests/limiter.test.ts': ["import { take } from '../src/limiter';", '', "console.log(take(1, 'a'));", ''].join('\n')
};

const DECOYS = Array.from({ length: 5 }, () => '// take the lock').join('\n');
const DECOYED_USE = `${DECOYS}\nimport { take } from './limiter';\ntake(3);\n`;

const SVELTE_BASE =
	'<script lang="ts" generics="T extends Record<string, unknown>">\n\tlet count = 0;\n</script>\n\n<p>{count}</p>\n';

const SVELTE_HEAD =
	'<script lang="ts" generics="T extends Record<string, unknown>">\n\tlet count = 0;\n\n\tfunction bump() {\n\t\tcount++;\n\t}\n</script>\n\n<button onclick={bump}>{count}</button>\n';

/**
 * Every change the change-model tests build, by name, so the behavior tests
 * and the flag-off parity snapshot read the same inputs.
 */
export const CASES = {
	limiterClass: { base: { 'src/limiter.ts': BASE_TS }, head: { 'src/limiter.ts': HEAD_TS } },
	pythonMethod: {
		base: {},
		head: {
			'app/store.py':
				'class Store:\n    def get(self, key, default=None):\n        return self.data.get(key, default)\n'
		}
	},
	svelteScript: { base: { 'ui/Counter.svelte': SVELTE_BASE }, head: { 'ui/Counter.svelte': SVELTE_HEAD } },
	noGrammar: { base: {}, head: { 'notes.txt': 'hello\n' } },
	addedExport: {
		base: {},
		head: {
			'src/query/index.ts': [
				'export type ParsedQuery = Record<string, string>;',
				'',
				'export function parseQuery(input: string): ParsedQuery {',
				'\treturn Object.fromEntries(new URLSearchParams(input));',
				'}',
				''
			].join('\n'),
			'src/query/index.test.ts': ["import { parseQuery } from '.';", '', "parseQuery('a=1');", ''].join('\n')
		}
	},
	shortName: {
		base: {},
		head: {
			'src/fn.ts': ['export function fn(): number {', '\treturn 1;', '}', ''].join('\n'),
			'src/caller.ts': ["import { fn } from './fn';", '', 'export const one = fn();', ''].join('\n'),
			'src/main.ts': ["import { one } from './caller';", '', 'console.log(one);', ''].join('\n')
		}
	},
	signatureChange: {
		base: { 'src/limiter.ts': BASE_LIMITER, ...UNCHANGED },
		head: { 'src/limiter.ts': HEAD_LIMITER, ...UNCHANGED }
	},
	folderImport: {
		base: {
			'src/q/index.ts': 'export function parse(a: string) {\n\treturn a;\n}\n',
			'src/main.ts': "import { parse } from './q';\nparse('x');\n"
		},
		head: {
			'src/q/index.ts': 'export function parse(a: string, b: string) {\n\treturn a + b;\n}\n',
			'src/main.ts': "import { parse } from './q';\nparse('x');\n"
		}
	},
	decoyedUse: {
		base: { 'src/limiter.ts': BASE_LIMITER, 'src/use.ts': DECOYED_USE },
		head: { 'src/limiter.ts': HEAD_LIMITER, 'src/use.ts': DECOYED_USE }
	}
} satisfies Record<string, FixtureCase>;
