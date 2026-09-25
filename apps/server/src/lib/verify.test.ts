import { expect, test } from 'bun:test';
import { EvidenceStore } from './evidence';
import { buildInventory } from './inventory';
import { parseVerdict, settleVerdict } from './verify';

function store(): EvidenceStore {
	const evidence = new EvidenceStore(null, buildInventory(''), 1000);
	evidence.records.set('ev_1', { id: 'ev_1', revision: 'head', path: '', startLine: 1, endLine: 1, content: '$ bun test\n1 fail', truncated: false, kind: 'run', command: 'bun test', exitCode: 1 });
	evidence.records.set('ev_2', { id: 'ev_2', revision: 'head', path: 'src/a.ts', startLine: 1, endLine: 10, content: '1|x', truncated: false });
	return evidence;
}

test('verifier answers with verdict synonyms and alternate field names are repaired', () => {
	expect(parseVerdict({ status: 'Reproduced', explanation: 'The repro fails.', evidenceIds: 'ev_1' })).toEqual({
		verdict: 'confirmed', reason: 'The repro fails.', evidenceIds: ['ev_1']
	});
	expect(parseVerdict({ verdict: 'false positive', reason: 'Passes.' })?.verdict).toBe('refuted');
	expect(parseVerdict({ verdict: 'maybe', reason: 'x' })).toBeNull();
});

test('a confirmed verdict counts only when it cites a command that ran', () => {
	const evidence = store();
	expect(settleVerdict({ verdict: 'confirmed', reason: 'Read the code.', evidenceIds: ['ev_2'] }, evidence)).toMatchObject({ status: 'unverified' });
	expect(settleVerdict({ verdict: 'confirmed', reason: 'The test fails.', evidenceIds: ['ev_2', 'ev_1'] }, evidence)).toEqual({
		status: 'verified', reason: 'The test fails.', command: 'bun test', exitCode: 1
	});
});

test('a refutation without a cited run keeps the finding as unverified', () => {
	const evidence = store();
	expect(settleVerdict({ verdict: 'refuted', reason: 'Looks fine.', evidenceIds: [] }, evidence)).toMatchObject({ status: 'unverified' });
	expect(settleVerdict({ verdict: 'refuted', reason: 'The test passes.', evidenceIds: ['ev_1'] }, evidence)).toBe('refuted');
});
