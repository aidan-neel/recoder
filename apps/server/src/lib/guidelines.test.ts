import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_GUIDELINES_CHARS } from '@recoder/shared';
import { composeGuidelines, GUIDELINES_TEMPLATE, hasRules, readGlobalGuidelines, withGuidelines, writeGlobalGuidelines } from './guidelines';

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-guidelines-'));
});

test('global guidelines round-trip and clear', () => {
	expect(readGlobalGuidelines()).toEqual({ content: '', updatedAt: null });
	const saved = writeGlobalGuidelines('## Focus\r\n- Flag float money math\r\n\r\n');
	expect(saved.content).toBe('## Focus\n- Flag float money math\n');
	expect(saved.updatedAt).not.toBeNull();
	expect(writeGlobalGuidelines('   ').content).toBe('');
});

test('rejects guidelines over the cap', () => {
	expect(() => writeGlobalGuidelines('x'.repeat(MAX_GUIDELINES_CHARS + 1))).toThrow();
});

test('an unfilled template has no rules', () => {
	expect(hasRules(GUIDELINES_TEMPLATE)).toBe(false);
	expect(hasRules('## Focus\n- Flag float money math')).toBe(true);
});

test('composes global then repo, labelled with source and base commit', () => {
	const composed = composeGuidelines({
		global: '## Focus\n- Prioritize data loss',
		repo: { content: '## Ignore\n- Naming nits', path: '.recoder/REVIEW.md', ref: 'main', sha: 'a1b2c3d4e5' }
	})!;
	expect(composed.block).toContain('Owner review guidelines (trusted)');
	expect(composed.block).toContain('the repository layer wins');
	expect(composed.block.indexOf('### Global')).toBeLessThan(composed.block.indexOf('### Repository'));
	expect(composed.block).toContain('### Repository (.recoder/REVIEW.md @ main a1b2c3d)');
	expect(composed.used.layers).toEqual([
		{ source: 'global', chars: 31, truncated: false },
		{ source: 'repo', path: '.recoder/REVIEW.md', ref: 'main', sha: 'a1b2c3d4e5', chars: 23, truncated: false }
	]);
	expect(composed.used.hash).toHaveLength(12);
});

test('skips empty layers and returns null when nothing is set', () => {
	expect(composeGuidelines({ global: GUIDELINES_TEMPLATE, repo: null })).toBeNull();
	const repoOnly = composeGuidelines({ global: '', repo: { content: '- Use Decimal for money', path: '.recoder/REVIEW.md' } })!;
	expect(repoOnly.used.layers.map((layer) => layer.source)).toEqual(['repo']);
});

test('truncates an oversized repo layer and says so', () => {
	const composed = composeGuidelines({ repo: { content: `- ${'a'.repeat(MAX_GUIDELINES_CHARS + 50)}`, path: '.recoder/REVIEW.md' } })!;
	expect(composed.used.layers[0].truncated).toBe(true);
	expect(composed.used.layers[0].chars).toBe(MAX_GUIDELINES_CHARS);
	expect(composed.block).toContain('[truncated]');
});

test('withGuidelines appends after the system prompt only when set', () => {
	expect(withGuidelines('SYSTEM', null)).toBe('SYSTEM');
	expect(withGuidelines('SYSTEM', 'BLOCK')).toBe('SYSTEM\n\nBLOCK');
});
