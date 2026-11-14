import { expect, test } from 'bun:test';
import {
	citedFiles,
	MAX_CITATIONS,
	MAX_TRAIL_STEPS,
	parseCitationTarget,
	withTrailStep,
	type ChatTrailStep
} from '../src/chat-trail';

const at = '2026-01-01T00:00:00.000Z';

const step = (id: string, text = ''): ChatTrailStep => ({ id, kind: 'thought', title: id, text, startedAt: at });

test('a citation target names each file with its lines, and skips what is not a reference', () => {
	expect(parseCitationTarget('#cite:src/a.ts:12-20,src/b.ts:7,README.md,bad ref:3')).toEqual([
		{ path: 'src/a.ts', startLine: 12, endLine: 20 },
		{ path: 'src/b.ts', startLine: 7 },
		{ path: 'README.md' }
	]);

	expect(parseCitationTarget('https://example.com')).toEqual([]);
	expect(parseCitationTarget('#cite:src/a.ts:20-12')).toEqual([]);
});

test('the files a reply cites are listed once each, in order, and capped', () => {
	const links = Array.from({ length: MAX_CITATIONS + 3 }, (_, index) => `[f](#cite:f${index}.ts:1)`).join(' ');

	expect(citedFiles('See [a](#cite:a.ts:1-2) and [again](#cite:a.ts:1-2), or [b](#cite:b.ts).')).toEqual([
		{ path: 'a.ts', startLine: 1, endLine: 2 },
		{ path: 'b.ts' }
	]);

	expect(citedFiles(links)).toHaveLength(MAX_CITATIONS);
});

test('a step with a known id replaces it in place; the trail keeps only the newest steps', () => {
	const trail = withTrailStep([step('a'), step('b')], step('a', 'longer'));

	expect(trail.map((item) => item.id)).toEqual(['a', 'b']);
	expect(trail[0]).toMatchObject({ text: 'longer' });

	const full = Array.from({ length: MAX_TRAIL_STEPS }, (_, index) => step(`s${index}`));

	expect(withTrailStep(full, step('new')).map((item) => item.id)).toEqual([
		...full.slice(1).map((item) => item.id),
		'new'
	]);
});
