import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withHash, type RunIdentity, type StageModel } from '../../src/eval/identity';

const stage: StageModel = {
	model: 'gpt-x',
	provider: 'opencode',
	effort: 'high',
	sampling: 'default',
	contextSize: 200_000
};

/** A recorded identity's fields: one experiment on PR `pr-1` at head `aaa`. */
export function identityFields(): Omit<RunIdentity, 'version' | 'hash'> {
	return {
		dataset: {
			name: 'synth',
			labels: 'labels-1',
			adjudications: 'adjudications-1',
			forges: { hono: { head: 'forge-head', metadata: 'forge-metadata' } }
		},
		code: { harness: 'harness-1', server: 'server-1' },
		models: { orchestrator: stage, specialist: { ...stage } },
		judge: { model: 'judge-x', provider: 'opencode', effort: 'medium', version: 1, seed: 7 },
		flags: { RECODER_TEST_STRENGTH: 'unset', RECODER_OBLIGATIONS: 'unset' },
		limits: { settings: { subagentCap: 2, reportLowSeverity: false }, policy: { analysisDeadlineMs: 1_800_000 } },
		caches: { intent: 'source:abc', 'benchmark-judge': 'v1' },
		tools: { bun: '1.3.0', node: 'v24.0.0', opencode: 'not installed' },
		tasks: [{ taskId: 'pr-1@aaa', base: 'base-1' }],
		host: {
			name: 'pc',
			os: 'linux 6',
			arch: 'x64',
			cpus: 16,
			sandbox: { runSlots: 4 },
			serverCommit: 'commit-1',
			inference: { weightRevision: 'unknown', quantization: 'unknown' }
		},
		execution: { mode: 'full', ran: 'full', concurrency: 3, timeoutMs: 2_700_000, runsPerPr: 1, baselineCache: true },
		unavailable: {}
	};
}

/** The identity a report written today records: every one of its `runs` reviewed under it. */
export function recordedIdentity(fields = identityFields(), runs = 1): RunIdentity {
	const identity = withHash(fields);

	return { ...identity, runs: { [identity.hash]: runs } };
}

/**
 * Writes a benchmark report with one hono PR whose one run found its planted
 * defect without publishing it; `identity` and `runIds` are left out for a
 * report older than recording them.
 */
export function writeReport(dir: string, name: string, recorded?: { identity: RunIdentity; runIds: string[] }): string {
	const path = join(dir, name);

	const report = {
		dataset: 'synth',
		base: 'http://localhost:3001',
		runsPerPr: 1,
		judge: { model: 'judge-x', provider: 'opencode', effort: 'medium' },
		...recorded,
		startedAt: '2026-10-06T00:00:00.000Z',
		finishedAt: '2026-10-06T00:10:00.000Z',
		prs: [
			{
				id: 'pr-1',
				codebase: 'hono',
				pull: 1,
				verified: true,
				control: false,
				staleHead: false,
				agreement: null,
				defects: [{ id: 'd1' }],
				runs: [
					{
						index: 1,
						outcome: 'passed',
						score: { found: { d1: 0 }, duplicates: [] },
						stages: { d1: { found: true, verified: true, published: false } }
					}
				]
			}
		],
		summary: {}
	};

	writeFileSync(path, JSON.stringify(report));

	return path;
}
