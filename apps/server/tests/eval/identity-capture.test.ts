import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelSettings } from '@recoder/shared';
import type { Adjudications } from '../../src/eval/benchmark-labels';
import { captureIdentity, type IdentityInput } from '../../src/eval/identity-capture';
import type { ServerIdentity } from '../../src/eval/server-identity';
import { sourceVersion } from '../../src/eval/source-hash';
import { localForgeFixture, type LocalForgeFixture } from '../helpers/local-forge';

let dataset = '';
let forge: LocalForgeFixture;

const settings: ModelSettings = {
	configured: true,
	baseUrl: 'https://api.example.com/v1',
	model: 'env-model',
	apiKeyPreview: 'sk-…prev',
	sharedModelId: 'review',
	orchestratorModelId: null,
	specialistModelId: null,
	models: [
		{
			id: 'review',
			label: 'Review',
			model: 'gpt-x',
			provider: 'opencode',
			baseUrl: null,
			apiKeyPreview: 'sk-…entry',
			contextWindow: 200_000
		},
		{ id: 'small', label: 'Small', model: 'gpt-mini', baseUrl: null, apiKeyPreview: null, runtime: { temperature: 0 } }
	],
	orchestratorEffort: 'high',
	specialistEffort: null,
	subagentCap: 2,
	reportLowSeverity: false,
	configPath: '/home/someone/.recoder/data/review-config.json',
	limits: { maxFiles: 200, maxDiffChars: 400_000, maxFileChars: 60_000 }
};

const server: ServerIdentity = {
	flags: { RECODER_LLM_RETRIES: '2' },
	policy: { analysisDeadlineMs: 1_800_000 },
	caches: { intent: 'source:1', 'rule-ledger': 'source:2', 'baseline-cache': 'source:3', 'review-checkpoint': 'v2' },
	tools: { bun: '1.4.2', node: 'v24.0.0', opencode: 'not installed' },
	host: {
		os: 'linux 6',
		arch: 'x64',
		cpus: 16,
		sandbox: { cpus: 12, runSlots: 6, prepSlots: 2, minFreeMb: 1024 },
		sandboxFlags: { RECODER_SANDBOX_RUNS: '6' }
	},
	code: 'source:server',
	commit: 'server-commit'
};

function writeLabel(id: string, label: Record<string, unknown>): void {
	writeFileSync(join(dataset, 'labels', `${id}.json`), JSON.stringify({ id, verified: true, defects: [], ...label }));
}

beforeAll(async () => {
	forge = await localForgeFixture();
	dataset = mkdtempSync(join(tmpdir(), 'recoder-identity-dataset-'));
	mkdirSync(join(dataset, 'labels'));
	writeLabel('pr-7', { codebase: 'local', repo: forge.repo.url, pull: 7, headSha: forge.pull7Head });
	writeLabel('pr-9', { codebase: 'remote', repo: 'https://example.com/remote.git', pull: 9, headSha: 'remote-head' });
});

afterAll(() => {
	rmSync(dataset, { recursive: true, force: true });
});

/** The identity of a benchmark over both PRs, with `change` applied to its inputs. */
function capture(change: Partial<IdentityInput> = {}) {
	return captureIdentity({
		dataset,
		tasks: [
			{ id: 'pr-9', codebase: 'remote', repo: 'https://example.com/remote.git', pull: 9, headSha: 'remote-head' },
			{ id: 'pr-7', codebase: 'local', repo: forge.repo.url, pull: 7, headSha: forge.pull7Head }
		],
		taskSet: 'full',
		adjudications: {},
		settings,
		judge: { model: 'judge-x', provider: 'opencode', effort: 'medium' },
		server,
		execution: { mode: 'full', auto: false, concurrency: 3, timeoutMs: 2_700_000, runsPerPr: 1, baselineCache: true },
		...change
	});
}

test('tasks carry their base from the local forge, and a repo it cannot read records unknown', async () => {
	const identity = await capture();

	expect(identity.tasks).toEqual([
		{ taskId: `pr-7@${forge.pull7Head}`, base: forge.squash },
		{ taskId: 'pr-9@remote-head', base: 'unknown' }
	]);

	expect(identity.dataset.forges.local!.head).toBe(forge.squash);
	expect(identity.dataset.forges.local!.metadata).toMatch(/^[0-9a-f]{64}$/);
	expect(identity.dataset.forges.remote).toEqual({ head: 'unknown', metadata: 'unknown' });
});

test('an unset second model follows the review model and its effort; the judge records its seed', async () => {
	const { models, judge, host } = await capture();

	expect(models.orchestrator).toEqual({
		model: 'gpt-x',
		provider: 'opencode',
		effort: 'high',
		sampling: 'default',
		contextSize: 200_000
	});

	expect(models.specialist).toEqual(models.orchestrator);
	expect(judge.seed).toBe(7);
	expect(host.inference).toEqual({ weightRevision: 'unknown', quantization: 'unknown' });

	const split = await capture({ settings: { ...settings, specialistModelId: 'small', specialistEffort: 'low' } });

	expect(split.models.specialist).toMatchObject({
		model: 'gpt-mini',
		provider: 'openai-compatible',
		effort: 'low',
		sampling: { temperature: 0 },
		contextSize: 'default'
	});

	expect(split.hash).not.toBe((await capture()).hash);

	const unlisted = await capture({ settings: { ...settings, specialistModelId: 'opencode:zen/gpt-big' } });

	expect(unlisted.models.specialist).toMatchObject({
		model: 'zen/gpt-big',
		provider: 'opencode',
		contextSize: 'unknown'
	});
});

test('a changed label file changes the labels hash and the identity hash', async () => {
	const before = await capture();

	writeLabel('pr-9', { codebase: 'remote', repo: 'https://example.com/remote.git', pull: 9, headSha: 'remote-head-2' });

	const after = await capture();

	expect(after.dataset.labels).not.toBe(before.dataset.labels);
	expect(after.hash).not.toBe(before.hash);
});

test('only decided adjudications count: a queued unresolved finding leaves the identity alone', async () => {
	const entry = (label: 'false' | 'unresolved') => ({ label, file: 'a.ts', line: 1, title: 'x', note: '' });
	const none = await capture();
	const queued = await capture({ adjudications: { k: entry('unresolved') } satisfies Adjudications });
	const decided = await capture({ adjudications: { k: entry('false') } satisfies Adjudications });

	expect(queued.dataset.adjudications).toBe(none.dataset.adjudications);
	expect(decided.dataset.adjudications).not.toBe(none.dataset.adjudications);
});

test('code is the content hash of the harness and the server sources; the server commit is only recorded', async () => {
	const identity = await capture();

	expect(identity.code).toEqual({ harness: sourceVersion(), server: 'source:server' });
	expect(identity.host.serverCommit).toBe('server-commit');
});

test('the host is named by the harness, since the server does not name its machine', async () => {
	expect((await capture()).host.name).toBe(hostname());
	expect((await capture({ server: null })).host.name).toBe(hostname());
});

test('a changed server flag changes the hash; a server without the route records unknown', async () => {
	const strong = await capture({ server: { ...server, flags: { ...server.flags, RECODER_TEST_STRENGTH: '1' } } });

	expect(strong.hash).not.toBe((await capture()).hash);

	const old = await capture({ server: null });

	expect(old.flags).toBe('unknown');
	expect(old.limits.policy).toBe('unknown');
	expect(old.code.server).toBe('unknown');
	expect(old.host.serverCommit).toBe('unknown');
	expect(old.unavailable.server).toContain('HTTP 404');

	expect(old.caches).toEqual({
		intent: 'unknown',
		'rule-ledger': 'unknown',
		'baseline-cache': 'unknown',
		'review-checkpoint': 'unknown',
		'benchmark-judge': 'v1'
	});
});

test('no key preview, endpoint or settings path reaches the identity', async () => {
	const text = JSON.stringify(await capture());

	for (const secret of ['sk-', 'api.example.com', 'review-config.json']) expect(text).not.toContain(secret);
});
