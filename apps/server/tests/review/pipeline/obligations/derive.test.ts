import type { Obligation, ObligationTrigger } from '@recoder/shared';
import { expect, test } from 'bun:test';
import { selectUnderCap } from '../../../../src/review/pipeline/obligations/derive';

const obligation = (id: string, trigger: ObligationTrigger): Obligation => ({
	id,
	unitId: 'unit-1',
	hunkId: 'src/a.ts:1,1:1,1',
	specialist: 'correctness',
	trigger,
	question: id,
	location: { file: 'src/a.ts', line: 1, side: 'new' },
	code: '',
	symbol: null,
	contractHints: []
});

const DERIVED = [
	obligation('obligation-1', 'boundary'),
	obligation('obligation-2', 'boundary'),
	obligation('obligation-3', 'boundary'),
	obligation('obligation-4', 'removed-guard'),
	obligation('obligation-5', 'error-contract')
];

test('the cap takes one obligation of each trigger in turn and keeps them in derived order', () => {
	const ids = (cap: number) => selectUnderCap(DERIVED, cap).map((entry) => entry.id);

	expect(ids(0)).toEqual([]);
	expect(ids(3)).toEqual(['obligation-1', 'obligation-4', 'obligation-5']);
	expect(ids(4)).toEqual(['obligation-1', 'obligation-2', 'obligation-4', 'obligation-5']);
	expect(ids(6)).toEqual(DERIVED.map((entry) => entry.id));
});
