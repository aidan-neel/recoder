import { expect, test } from 'bun:test';
import type { Finding, FindingVerification } from '@recoder/shared';
import { renderEvidence } from '../../../src/forge/publish/evidence';

function verified(verification: Omit<FindingVerification, 'status'>, overrides: Partial<Finding> = {}): Finding {
	return {
		id: 'f',
		file: 'src/a.ts',
		line: 3,
		severity: 'error',
		message: 'm',
		verification: { status: 'verified', ...verification },
		...overrides
	};
}

test('a reproduced finding shows the command, its output and the base comparison', () => {
	const body = renderEvidence(
		verified({
			reason: 'fails',
			method: 'run',
			evidence: {
				command: 'bun test limiter',
				exitCode: 1,
				observed: 'expected 2, got 3',
				evidenceId: 'e1',
				baseline: { exitCode: 0, differs: true, result: 'regression' }
			}
		})
	);

	expect(body).toContain('**Evidence:** Reproduced');
	expect(body).toContain('```sh\nbun test limiter\n```');
	expect(body).toContain('```text\nexpected 2, got 3\n```');
	expect(body).toContain('Base commit: passes on the base commit and fails with this change.');
});

test('run output holding a fence cannot close the block around it', () => {
	const body = renderEvidence(
		verified({
			reason: 'r',
			method: 'run',
			evidence: { command: 'x', exitCode: 1, observed: '```\n@team look', evidenceId: 'e' }
		})
	);

	expect(body).toContain('````text\n```\n@team look\n````');
});

test('a traced finding shows the source path the verifier followed', () => {
	const body = renderEvidence(
		verified(
			{ reason: 'traced', method: 'trace' },
			{
				claim: {
					trigger: 't',
					executionPath: [{ file: 'src/a.ts', line: 3, note: 'reads @owner' }],
					consequence: 'c',
					violatedContract: 'v'
				}
			}
		)
	);

	expect(body).toContain('**Evidence:** Traced in code');
	expect(body).toContain('- `src/a.ts:3` reads @​owner');
});

test('a detector finding names the deterministic check', () => {
	const body = renderEvidence(verified({ reason: 'found', method: 'detector' }, { lens: 'detector:duplication' }));

	expect(body).toContain('Deterministic check: `detector:duplication`');
});

test('a rule finding quotes the rule and its source, and falls back to the rule id', () => {
	const rule = { id: 'R4', text: 'No // comments.\n@everyone read this', source: { path: 'AGENTS.md', line: 12 } };
	const quoted = renderEvidence(verified({ reason: 'breaks it', method: 'rule' }, { rule }));
	const bare = renderEvidence(verified({ reason: 'breaks it', method: 'rule' }, { ruleId: 'R4' }));

	expect(quoted).toContain('**Evidence:** Repository rule');
	expect(quoted).toContain('> No // comments.\n> @​everyone read this');
	expect(quoted).toContain('Rule `R4` from `AGENTS.md:12`');
	expect(bare).toContain('Rule `R4`');
});

test('an unverified finding says so with the reason', () => {
	const body = renderEvidence({
		id: 'f',
		file: 'a.ts',
		severity: 'warning',
		message: 'm',
		verification: { status: 'unverified', reason: 'no checks could run' }
	});

	expect(body).toBe('**Evidence:** Not verified\n\nno checks could run');
});

test('a verifier reason holding a suggestion fence renders as prose that no forge applies', () => {
	const reason = 'Replace it:\n```suggestion\nfixed\n```\n~~~suggestion\nalso\n~~~';
	const body = renderEvidence(verified({ reason, method: 'trace' }));

	expect(body).not.toMatch(/`{3}|~{3}/);
	expect(body).toContain('suggestion\nfixed');
});
