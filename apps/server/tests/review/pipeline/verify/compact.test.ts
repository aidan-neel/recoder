import { expect, test } from 'bun:test';
import { EvidenceStore } from '../../../../src/evidence/evidence';
import type { CandidateFinding } from '../../../../src/review/pipeline/consolidate';
import { buildInventory } from '../../../../src/review/pipeline/inventory';
import { compactCitedEvidence, compactVerifierSource } from '../../../../src/review/pipeline/verify/compact';
import { addedFile } from '../harness-fixtures';

const candidate: CandidateFinding = {
	id: 'C1',
	candidateId: 'C1',
	valid: true,
	file: 'src/a.ts',
	line: 100,
	severity: 'warning',
	category: 'correctness',
	message: 'lost value'
};

test('compact preloading records the anchored source once and reuses a cited window without executing code', async () => {
	const evidence = new EvidenceStore(null, buildInventory(addedFile('src/a.ts', 200)), 12000);
	const user = await compactVerifierSource(candidate, evidence, 'task');
	const [record] = [...evidence.records.values()];

	expect(evidence.records.size).toBe(1);
	expect(record).toMatchObject({ path: candidate.file, revision: 'head', startLine: 88, endLine: 112 });
	expect(record.kind).not.toBe('run');
	expect(user).toContain(record.id);
	expect(user).toContain('100|');

	const cited = { ...candidate, evidenceIds: [record.id] };
	const prompt = compactCitedEvidence(cited, evidence);

	expect(await compactVerifierSource(cited, evidence, prompt)).toBe(prompt);
	expect(evidence.records.size).toBe(1);
});

test('compact evidence deduplicates reads, keeps the anchor and run failure tail, and leaves stored evidence intact', () => {
	const evidence = new EvidenceStore(null, buildInventory(''), 12000);
	const content = Array.from({ length: 200 }, (_, index) => `${index + 1}|${'x'.repeat(100)}`).join('\n');

	const read = {
		id: 'E1',
		revision: 'head' as const,
		path: candidate.file,
		startLine: 1,
		endLine: 200,
		content,
		truncated: false
	};

	evidence.records.set('E1', read);
	evidence.records.set('E2', { ...read, id: 'E2', agentId: 'another-reviewer' });

	evidence.records.set('E3', {
		...read,
		id: 'E3',
		kind: 'run',
		command: 'python repro.py',
		content: `$ python repro.py\n${'log\n'.repeat(1000)}AssertionError: expected 1 got 2\n[exit 1]`
	});

	const payload = compactCitedEvidence({ ...candidate, evidenceIds: ['E3', 'E1', 'E2'] }, evidence);

	expect(payload.startsWith('E1')).toBe(true);
	expect(payload).not.toContain('E2');
	expect(payload).toContain('100|');
	expect(payload).toContain('$ python repro.py');
	expect(payload).toContain('AssertionError: expected 1 got 2\n[exit 1]');
	expect(payload.length).toBeLessThan(4500);
	expect(evidence.get('E1')?.content).toBe(content);
});

test('missing source and cancellation leave the task intact with no fabricated evidence', async () => {
	const evidence = new EvidenceStore(null, buildInventory(''), 12000);

	expect(await compactVerifierSource(candidate, evidence, 'task')).toBe('task');
	expect(evidence.records.size).toBe(0);

	const abort = new AbortController();

	abort.abort();
	expect(await compactVerifierSource(candidate, evidence, 'task', abort.signal)).toBe('task');
	expect(evidence.records.size).toBe(0);
	expect(compactCitedEvidence({ ...candidate, evidenceIds: ['missing'] }, evidence)).toBe('');
});

test('a head citation cannot supply source for an old-side finding', async () => {
	const evidence = new EvidenceStore(null, buildInventory(addedFile('src/a.ts', 200)), 12000);

	await compactVerifierSource(candidate, evidence, 'task');

	const [head] = [...evidence.records.values()];
	const old = { ...candidate, side: 'old' as const, evidenceIds: [head.id] };

	expect(await compactVerifierSource(old, evidence, 'old task')).toBe('old task');
	expect(evidence.records.size).toBe(1);
});
