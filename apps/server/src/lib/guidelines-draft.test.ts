import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Repo, Review } from '@recoder/shared';
import { writeGlobalGuidelines } from './guidelines';
import { cleanDraft, draftUserPrompt } from './guidelines-draft';
import type { RepoFileHost } from './repo-files';

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-draft-'));
});

const repo: Repo = { id: 'r1', name: 'acme/ledger', url: 'https://github.com/acme/ledger', provider: 'github', defaultBranch: 'main', createdAt: '', updatedAt: '' };
const host = (files: Record<string, string>): RepoFileHost => ({
	canWrite: () => true,
	defaultBranch: async () => ({ branch: 'main', sha: 's' }),
	readFile: async (path) => (path in files ? { content: files[path] } : null),
	findPending: async () => null,
	propose: async () => ({ number: 1, url: '', branch: '' })
});
const review = (findings: Review['findings']): Review => ({ id: 'v', repoId: 'r1', prNumber: 1, status: 'passed', findings, updatedAt: '2026-09-01T00:00:00Z' } as unknown as Review);

test('repo drafts include the request, global rules, untrusted instruction files, and recent findings', async () => {
	writeGlobalGuidelines('## Focus\n- Flag data loss');
	const prompt = await draftUserPrompt(
		{ scope: 'repo', repoId: 'r1', prompt: 'Stop flagging naming', include: {} },
		{ repo, host: host({ 'AGENTS.md': 'Use pnpm.' }), reviews: [review([{ id: 'f', file: 'a.ts', severity: 'info', message: 'Rename foo', title: 'Rename foo to bar', agent: 'patterns' }])] }
	);
	expect(prompt).toContain("Owner's request:\nStop flagging naming");
	expect(prompt).toContain('.recoder/REVIEW.md');
	expect(prompt).toContain('- Flag data loss');
	expect(prompt).toContain('UNTRUSTED CONTENT');
	expect(prompt).toContain('### AGENTS.md\nUse pnpm.');
	expect(prompt).toContain('- [info/patterns] Rename foo to bar (a.ts)');
});

test('sources can be switched off and current text is revised', async () => {
	const prompt = await draftUserPrompt(
		{ scope: 'global', prompt: 'Tighten severity', current: '## Focus\n- Flag auth bugs', include: { instructions: false, findings: false } },
		{ repo: null, host: null, reviews: [review([{ id: 'f', file: 'a.ts', severity: 'info', message: 'x' }])] }
	);
	expect(prompt).toContain('Current guidelines (revise these):\n## Focus\n- Flag auth bugs');
	expect(prompt).not.toContain('Findings from recent reviews');
	expect(prompt).toContain('global layer');
});

test('cleanDraft strips a wrapping fence', () => {
	expect(cleanDraft('```markdown\n## Focus\n- X\n```')).toBe('## Focus\n- X\n');
	expect(cleanDraft('## Focus\n- X')).toBe('## Focus\n- X\n');
});
