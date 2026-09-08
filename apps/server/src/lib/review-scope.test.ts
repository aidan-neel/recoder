import { describe, expect, test } from 'bun:test';
import type { FileDiff } from '@recoder/shared';
import { scopeReviewFiles } from './review-scope';

const file = (path: string): FileDiff => ({ path, additions: 1, deletions: 0, hunks: [] });

describe('scopeReviewFiles', () => {
	test('keeps ordinary source files', () => {
		const { included, skipped } = scopeReviewFiles([
			file('src/rate-limit/limiter.ts'),
			file('apps/web/src/routes/+page.svelte')
		]);
		expect(included.map((f) => f.path)).toEqual([
			'src/rate-limit/limiter.ts',
			'apps/web/src/routes/+page.svelte'
		]);
		expect(skipped).toEqual([]);
	});

	test('skips build output, vendor dirs, and generated trees', () => {
		const { included, skipped } = scopeReviewFiles([
			file('packages/sivir/.svelte-kit/__package__/components/button.svelte'),
			file('apps/web/dist/assets/app.js'),
			file('node_modules/acme/index.js'),
			file('src/index.ts')
		]);
		expect(included.map((f) => f.path)).toEqual(['src/index.ts']);
		expect(skipped).toHaveLength(3);
		expect(skipped[0].reason).toMatch(/generated|build/);
	});

	test('skips lockfiles, declarations, maps, and binaries', () => {
		const { included, skipped } = scopeReviewFiles([
			file('bun.lock'),
			file('src/types.d.ts'),
			file('assets/app.min.js'),
			file('assets/app.js.map'),
			file('assets/logo.png'),
			file('assets/font.woff2'),
			file('src/app.ts')
		]);
		expect(included.map((f) => f.path)).toEqual(['src/app.ts']);
		expect(skipped.map((s) => s.path)).toEqual([
			'bun.lock',
			'src/types.d.ts',
			'assets/app.min.js',
			'assets/app.js.map',
			'assets/logo.png',
			'assets/font.woff2'
		]);
	});

	test('skips unresolvable paths', () => {
		const { included } = scopeReviewFiles([file('unknown'), file('a.ts')]);
		expect(included.map((f) => f.path)).toEqual(['a.ts']);
	});

	test('honors extra substring patterns', () => {
		const { included } = scopeReviewFiles([file('db/migrations/001.sql'), file('src/a.ts')], [
			'migrations'
		]);
		expect(included.map((f) => f.path)).toEqual(['src/a.ts']);
	});
});
