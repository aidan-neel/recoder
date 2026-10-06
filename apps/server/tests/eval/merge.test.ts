import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shardOf, unsplitReport, writeReports } from '../helpers/shards';

const dir = mkdtempSync(join(tmpdir(), 'recoder-merge-'));
const src = join(import.meta.dir, '../../src/eval');

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

function run(script: string, ...args: string[]): { code: number; out: string } {
	const result = Bun.spawnSync([process.execPath, join(src, script), ...args], { stdout: 'pipe', stderr: 'pipe' });

	return { code: result.exitCode, out: `${result.stdout.toString()}${result.stderr.toString()}` };
}

const unsplit = unsplitReport();

test('merging every shard writes the unsplit prs and compares equal to the unsplit report', () => {
	const [whole, ...shards] = writeReports(dir, {
		whole: unsplit,
		'pc-1': shardOf(unsplit, 1, 2, 'pc'),
		'mac-2': shardOf(unsplit, 2, 2, 'mac')
	});

	const out = join(dir, 'merged.json');
	const merged = run('merge.ts', out, ...shards);

	expect(merged.code).toBe(0);
	expect(merged.out).toContain('Merged 2 reports: 5 PRs, 10 runs');
	expect(JSON.stringify(JSON.parse(readFileSync(out, 'utf8')).prs)).toBe(JSON.stringify(unsplit.prs));
	expect(run('compare.ts', whole!, out).out).toContain('Compatible: every checked field matches');
	expect(run('merge.ts', out, ...shards).out).toContain('exists; the merge writes a new file');
});

test('missing shards refuse a merge with each missing task listed; --partial writes one marked partial', () => {
	const [first, third] = writeReports(dir, { 'of3-1': shardOf(unsplit, 1, 3), 'of3-3': shardOf(unsplit, 3, 3) });
	const out = join(dir, 'partial.json');
	const refused = run('merge.ts', out, first!, third!);

	expect(refused.code).toBe(1);
	expect(refused.out).toContain('Missing tasks (2):\n  ky-1@ky-1-head\n  ky-3@ky-3-head\nNot merging');
	expect(existsSync(out)).toBe(false);

	const partial = run('merge.ts', out, first!, third!, '--partial');

	expect(partial.code).toBe(0);
	expect(partial.out).toContain('Partial: tasks are missing, so this is no complete score.');
	expect(JSON.parse(readFileSync(out, 'utf8')).summary.partial).toBe(true);
	expect(run('compare.ts', out, out).out).toContain('PARTIAL merge, tasks missing');
});

test('an incompatible shard is refused with the field named and nothing written', () => {
	const other = shardOf(unsplit, 2, 2);

	other.identity = { ...other.identity!, taskSet: 'quick' };

	const out = join(dir, 'refused.json');
	const refused = run('merge.ts', out, ...writeReports(dir, { 'set-1': shardOf(unsplit, 1, 2), 'set-2': other }));

	expect(refused.code).toBe(1);
	expect(refused.out).toContain('Not merging:\n  set-2.json differs from set-1.json in taskSet: full → quick');
	expect(existsSync(out)).toBe(false);

	const declared = run('merge.ts', out, join(dir, 'set-1.json'), join(dir, 'set-2.json'), '--allow-diff', 'taskSet');

	expect(declared.code).toBe(0);
	expect(declared.out).toContain('Declared: set-2.json taskSet: full → quick');
});
