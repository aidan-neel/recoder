import { afterAll, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BenchmarkReport } from '../../src/eval/benchmark-report';
import { auditLines, auditReport } from '../../src/eval/reviewer-audit';
import type { PipelineRun, RunTokenCall, StoredMetrics } from '../../src/models/metrics';

const dir = mkdtempSync(join(tmpdir(), 'recoder-reviewer-audit-'));

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

/** Pipeline calls: `count` on `model`, tagged with `run` when given. */
function calls(model: string, count: number, run?: number): RunTokenCall[] {
	return Array.from({ length: count }, (_, index) => ({
		id: `${model}-${run ?? 'untagged'}-${index}`,
		model,
		provider: 'openai-compatible',
		scope: 'pipeline',
		status: 'completed',
		usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
		...(run === undefined ? {} : { run })
	})) as RunTokenCall[];
}

function run(index: number, orchestrator: string, subagent: string): PipelineRun {
	return { index, startedAt: '2026-10-05T22:43:18.000Z', orchestrator, subagent, lockMisses: 0 };
}

/** Review metrics by review id: a clean run, the field case of a replay on another model appended untagged, a rerun on the same models, and a rerun on new ones. */
const ROWS: Record<string, Pick<StoredMetrics, 'runs' | 'calls'>> = {
	'review-clean': {
		runs: [run(0, 'lead-a', 'worker-a')],
		calls: [...calls('lead-a', 11, 0), ...calls('worker-a', 5, 0)]
	},
	'review-mixed': { calls: [...calls('lead-a', 288), ...calls('lead-b', 63)] },
	'review-rerun': {
		runs: [run(0, 'lead-a', 'worker-a'), run(1, 'lead-a', 'worker-a')],
		calls: [...calls('lead-a', 4, 0), ...calls('worker-a', 3, 1)]
	},
	'review-switched': {
		runs: [run(0, 'lead-a', 'worker-a'), run(1, 'lead-b', 'worker-b')],
		calls: [...calls('lead-a', 4, 0), ...calls('worker-b', 3, 1)]
	}
};

/**
 * A store named `name` holding `ROWS` in the server's review_metrics table, plus a discussion call that is no
 * pipeline call. Like the server's it is a WAL database; closing it leaves no `-wal` or `-shm` file beside it.
 */
function writeStore(name = 'recoder.db'): string {
	const path = join(dir, name);
	const store = new Database(path);

	store.run('PRAGMA journal_mode = WAL');
	store.run('CREATE TABLE IF NOT EXISTS review_metrics (id TEXT PRIMARY KEY, value TEXT NOT NULL)');

	for (const [id, row] of Object.entries(ROWS)) {
		const discussion = { ...calls('chat-model', 1)[0]!, scope: 'discussion' };

		store.run('INSERT INTO review_metrics (id, value) VALUES (?, ?)', [
			id,
			JSON.stringify({ id, startedAt: '', pipelineTracked: true, ...row, calls: [...row.calls, discussion] })
		]);
	}

	store.close();

	return path;
}

/** A report reviewed by lead-a with worker-a whose runs are the reviews `ids`, one PR per id. */
function writeReport(name: string, ids: string[]): { path: string; report: BenchmarkReport } {
	const report = {
		dataset: 'synth',
		reviewer: { model: 'lead-a', specialistModel: 'worker-a' },
		prs: ids.map((reviewId, index) => ({ id: `task-${index + 1}`, runs: [{ index: 1, reviewId }] }))
	} as unknown as BenchmarkReport;

	const path = join(dir, name);

	writeFileSync(path, JSON.stringify(report));

	return { path, report };
}

/** Runs the CLI as a developer would, from the server package. */
function cli(reportPath: string, storePath: string, ...flags: string[]): { code: number; out: string } {
	const result = Bun.spawnSync(['bun', 'src/eval/reviewer-audit.ts', reportPath, storePath, ...flags], {
		cwd: join(import.meta.dir, '../..')
	});

	return { code: result.exitCode, out: result.stdout.toString() };
}

const store = writeStore();

test('each run is CLEAN, MIXED or MISSING by its pipeline calls, run by run, and a mixed report exits 1', () => {
	const ids = ['review-clean', 'review-mixed', 'review-gone', 'review-rerun', 'review-switched'];
	const { path, report } = writeReport('mixed.json', ids);
	const database = new Database(store, { readonly: true });
	const audits = auditReport(report, database);

	database.close();

	expect(audits.map((audit) => [audit.reviewId, audit.status, audit.runs])).toEqual([
		['review-clean', 'CLEAN', 1],
		['review-mixed', 'MIXED', 0],
		['review-gone', 'MISSING', 0],
		['review-rerun', 'CLEAN', 2],
		['review-switched', 'MIXED', 2]
	]);

	const { code, out } = cli(path, store);

	expect(code).toBe(1);
	expect(out.trimEnd().split('\n')).toEqual(auditLines(report, audits));

	expect(out).toContain(
		[
			'  task-2 #1 review-mixed MIXED  pipeline runs 0  lock misses 0  unlocked calls 0',
			'    runs not recorded: lead-a×288 lead-b×63',
			'    MIXED: runs not recorded called lead-b'
		].join('\n')
	);

	expect(out).toContain(
		[
			'  task-5 #1 review-switched MIXED  pipeline runs 2  lock misses 0  unlocked calls 0',
			'    run 0 [lead-a/worker-a]: lead-a×4',
			'    run 1 [lead-b/worker-b]: worker-b×3',
			'    MIXED: runs locked different models: lead-a/worker-a, lead-b/worker-b',
			'    MIXED: run 1 called worker-b'
		].join('\n')
	);

	expect(out).toContain(
		'Summary: 5 runs, 2 clean, 2 mixed, 1 missing from the store, 2 with more than one pipeline run'
	);
});

test('a report whose runs are clean or missing exits 0, and the store is never written', () => {
	const { path } = writeReport('clean.json', ['review-clean', 'review-gone']);
	const before = Bun.file(store).size;
	const { code, out } = cli(path, store);

	expect(code).toBe(0);

	expect(out).toContain(
		'  task-1 #1 review-clean CLEAN  pipeline runs 1  lock misses 0  unlocked calls 0\n    run 0 [lead-a/worker-a]: lead-a×11 worker-a×5'
	);

	expect(out).toContain(
		'Summary: 2 runs, 1 clean, 0 mixed, 1 missing from the store, 0 with more than one pipeline run'
	);

	expect(Bun.file(store).size).toBe(before);
});

test('a run made without locked models is MIXED by its lock misses', () => {
	const path = join(dir, 'missed.db');
	const database = new Database(path);
	const missed = { ...calls('lead-a', 1, 0)[0]!, lockMiss: true };
	const row = { runs: [{ ...run(0, 'lead-a', 'worker-a'), lockMisses: 2 }], calls: [missed] };

	database.run('CREATE TABLE review_metrics (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
	database.run('INSERT INTO review_metrics (id, value) VALUES (?, ?)', ['review-missed', JSON.stringify(row)]);

	const [audit] = auditReport(writeReport('missed.json', ['review-missed']).report, database);

	database.close();

	expect(audit).toMatchObject({
		status: 'MIXED',
		lockMisses: 2,
		unlockedCalls: 1,
		reasons: ['2 lock misses, 1 unlocked calls']
	});
});

/** The file's SHA-256, to show it was not changed. */
function hashOf(path: string): string {
	return new Bun.CryptoHasher('sha256').update(readFileSync(path)).digest('hex');
}

test('--snapshot reads a WAL store as immutable: the same audit, no side files, the file unchanged', () => {
	const snapshot = writeStore('snapshot.db');
	const { path } = writeReport('snapshot.json', ['review-clean', 'review-mixed', 'review-gone']);
	const before = hashOf(snapshot);
	const sideFiles = () => ['-wal', '-shm', '-journal'].filter((suffix) => existsSync(`${snapshot}${suffix}`));

	expect(sideFiles()).toEqual([]);

	const { code, out } = cli(path, snapshot, '--snapshot');

	expect(code).toBe(1);

	expect(out).toContain(
		'Summary: 3 runs, 1 clean, 1 mixed, 1 missing from the store, 0 with more than one pipeline run'
	);

	expect(sideFiles()).toEqual([]);
	expect(hashOf(snapshot)).toBe(before);
});
