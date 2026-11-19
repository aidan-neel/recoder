import { expect, test } from 'bun:test';

import { dedent, guessLanguage } from '../../src/components/content/code-shape';

test('code quoted from deep in a file loses the indentation its lines share and keeps the rest', () => {
	expect(dedent('\t\t\tif (ready) {\n\t\t\t\tstart();\n\t\t\t}')).toBe('if (ready) {\n\tstart();\n}');
});

test('a blank line between indented lines does not stop the shared indentation from going', () => {
	expect(dedent('    a\n\n    b')).toBe('a\n\nb');
});

test('code with one line at the edge is left as written', () => {
	const code = 'function a() {\n\treturn 1;\n}';

	expect(dedent(code)).toBe(code);
});

test('lines that mix tabs and spaces lose only the whitespace they truly share', () => {
	expect(dedent('\t  a\n\t\tb')).toBe('  a\n\tb');
});

test('a block of only blank lines is left as written', () => {
	expect(dedent('\n  \n')).toBe('\n  \n');
});

test.each([
	['diff', '@@ -1,2 +1,2 @@\n-old\n+new'],
	['diff', ' same\n-const a = 1;\n+const a = 2;'],
	['json', '{\n  "name": "recoder",\n  "private": true\n}'],
	['bash', '$ bun run verify'],
	['bash', 'bun install\nbun run dev'],
	['bash', 'make build'],
	['xml', '<div class="row">\n  <span>One</span>\n</div>'],
	['python', 'def renew(token):\n    return token.refresh()'],
	['go', 'func (s *Store) Renew(ctx context.Context) error {\n\treturn nil\n}'],
	['rust', 'pub fn renew(token: &Token) -> Result<Token> {\n    todo!()\n}'],
	['sql', 'SELECT id, name FROM users WHERE active'],
	['sql', 'select id from users;'],
	['typescript', "import { renew } from './token';\n\nexport const lease = renew(token);"],
	['typescript', 'items.map((item) => item.id)'],
	['yaml', 'services:\n  api:\n    image: recoder']
] as const)('a fence with no language reads as %s from its text', (language, code) => {
	expect(guessLanguage(code)).toBe(language);
});

test.each([
	['a sentence', 'The lock is released when the tab closes.'],
	['a log line with an arrow', 'GET /api/pulls => 200 in 12ms'],
	['a sentence that starts with a program word', 'make sure the lock is released before the tab closes'],
	['a sentence that reads like a query', 'Select the file from the list'],
	['a note over a list', 'Note: two things changed\n- the store\n- the lock'],
	['a stack trace', 'TypeError: token is undefined\n    at renew (token.js:12:5)'],
	['an error a program printed', 'npm ERR! code E404\nnpm ERR! 404 Not Found'],
	['a file tree', 'src/\n  lib/\n    token.ts']
])('%s in a fence with no language stays plain', (_what, code) => {
	expect(guessLanguage(code)).toBeNull();
});
