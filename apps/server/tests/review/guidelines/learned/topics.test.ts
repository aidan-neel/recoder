import { expect, test } from 'bun:test';
import type { Finding } from '@recoder/shared';
import { isDismissedOften, rankRules, ruleTopicId, withTopics } from '../../../../src/review/guidelines/learned/topics';
import type { RuleLedger } from '../../../../src/review/guidelines/ledger/types';
import type { TopicTally } from '../../../../src/review/guidelines/learned/votes';

const ledger: RuleLedger = {
	sourcesHash: 'h',
	rules: [
		{ id: 'R1', text: 'Files stay under 500 lines.', source: { path: 'AGENTS.md' } },
		{ id: 'R2', text: 'Comments are JSDoc only.', source: { path: 'AGENTS.md' } },
		{ id: 'R3', text: 'No duplicated code.', source: { path: 'AGENTS.md' } }
	]
};

const finding = (overrides: Partial<Finding>): Finding => ({
	id: 'f1',
	file: 'src/a.ts',
	line: 1,
	severity: 'warning',
	message: '[readability] A bare number',
	category: 'readability',
	smell: 'magic-value',
	...overrides
});

const tallies = (entries: Record<string, TopicTally>) => new Map(Object.entries(entries));

test('a topic is quieted once a person approves it, and votes alone never quiet one', () => {
	const [quiet, kept] = withTopics(
		[finding({}), finding({ id: 'f2', category: 'dead-code', smell: undefined })],
		ledger,
		tallies({
			'smell:magic-value': { useful: 0, dismissed: 1, quietApproved: true },
			'category:dead-code': { useful: 0, dismissed: 10 }
		})
	);

	expect(quiet.topic).toEqual({ id: 'smell:magic-value', label: 'Magic value', quieted: true });
	expect(kept.topic).toEqual({ id: 'category:dead-code', label: 'Dead code' });
});

test('a topic people keep dismissing is dismissed often, and one they also act on is not', () => {
	expect(isDismissedOften({ useful: 0, dismissed: 3 })).toBe(true);
	expect(isDismissedOften({ useful: 1, dismissed: 3 })).toBe(false);
});

test('a finding a run proved is never quieted', () => {
	const [proven] = withTopics(
		[
			finding({
				category: 'correctness',
				smell: undefined,
				verification: { status: 'verified', method: 'run', reason: 'the test fails' }
			})
		],
		ledger,
		tallies({ 'category:correctness': { useful: 0, dismissed: 10, quietApproved: true } })
	);

	expect(proven.topic?.quieted).toBeUndefined();
});

test('a rule finding counts toward the rule text, so renumbering the ledger keeps its votes', () => {
	const renumbered: RuleLedger = { ...ledger, rules: [{ ...ledger.rules[1], id: 'R7' }] };

	const [cited] = withTopics(
		[finding({ category: 'repo-rule', smell: undefined, ruleId: 'R7' })],
		renumbered,
		new Map()
	);

	expect(cited.topic?.id).toBe(ruleTopicId(ledger.rules[1]));
});

test('rules people act on rank first and rules they keep dismissing rank last', () => {
	const ranked = rankRules(
		ledger,
		tallies({
			[ruleTopicId(ledger.rules[0])]: { useful: 0, dismissed: 4 },
			[ruleTopicId(ledger.rules[2])]: { useful: 3, dismissed: 0 }
		})
	);

	expect(ranked?.rules.map((rule) => [rule.id, rule.standing])).toEqual([
		['R3', 'acted-on'],
		['R2', undefined],
		['R1', 'often-dismissed']
	]);
});
