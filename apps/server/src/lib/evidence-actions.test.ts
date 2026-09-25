import { expect, test } from 'bun:test';
import { parseActions } from './evidence';

test('accepts the action shapes local models emit', () => {
	expect(parseActions({ actions: [{ readDiff: { path: 'a.py' } }] })).toEqual([{ action: 'readDiff', path: 'a.py' }]);
	expect(parseActions({ readFile: { path: 'a.py' } })).toEqual([{ action: 'readFile', path: 'a.py' }]);
	expect(parseActions({ actions: [{ name: 'search', arguments: '{"query":"x"}' }] })).toEqual([{ action: 'search', query: 'x' }]);
	expect(parseActions({ actions: [{ tool: 'listFiles', args: { prefix: 'src' } }] })).toEqual([{ action: 'listFiles', prefix: 'src' }]);
	expect(parseActions({ actions: [{ action: 'readFile', path: 'b' }] })).toEqual([{ action: 'readFile', path: 'b' }]);
	expect(parseActions({ findings: [] })).toBeNull();
});

test('accepts the type/args shape and field aliases from the ark review', () => {
	expect(parseActions({ actions: [{ type: 'search', args: { pattern: 'output_queue|status_queue' } }] }))
		.toEqual([{ action: 'search', query: 'output_queue|status_queue' }]);
	expect(parseActions({ tool_calls: [{ function: { name: 'read_file', arguments: '{"file":"a.py","lines":"10-40"}' } }] }))
		.toEqual([{ action: 'readFile', path: 'a.py', startLine: 10, endLine: 40 }]);
	expect(parseActions({ actions: [{ action: 'readFile', path: 'a.py', revision: 'base' }] }))
		.toEqual([{ action: 'readFile', path: 'a.py', revision: 'target' }]);
});
