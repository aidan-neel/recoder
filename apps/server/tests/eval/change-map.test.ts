import { expect, test } from 'bun:test';
import { pickMode } from '../../src/eval/change-map';

const SRC = 'apps/server/src/';

test('a change under detectors picks replay and one under lenses picks a full run', () => {
	expect(pickMode([`${SRC}review/pipeline/detectors/null-deref.ts`]).mode).toBe('replay');
	expect(pickMode([`${SRC}review/pipeline/lenses/security.ts`]).mode).toBe('full');
});

test('verifier code picks a reverify and scoring code only a rescore', () => {
	expect(pickMode([`${SRC}review/pipeline/verify/prompt.ts`]).mode).toBe('reverify');
	expect(pickMode([`${SRC}review/pipeline/quality-verify.ts`]).mode).toBe('reverify');
	expect(pickMode([`${SRC}eval/benchmark-score.ts`]).mode).toBe('rescore');
});

test('a path the map does not know, such as a new folder, selects a full run', () => {
	expect(pickMode([`${SRC}review/pipeline/new-stage/index.ts`]).mode).toBe('full');
	expect(pickMode(['bun.lock']).mode).toBe('full');
	expect(pickMode([`${SRC}eval/run-review.ts`]).mode).toBe('full');
});

test('the most expensive path decides, and the result names the paths that decided it', () => {
	const picked = pickMode([
		`${SRC}review/pipeline/detectors/a.ts`,
		`${SRC}review/pipeline/verify/b.ts`,
		`${SRC}review/pipeline/consolidate.ts`
	]);

	expect(picked).toEqual({ mode: 'reverify', decidedBy: [`${SRC}review/pipeline/verify/b.ts`] });
});

test('nothing changed is a rescore', () => {
	expect(pickMode([])).toEqual({ mode: 'rescore', decidedBy: [] });
});
