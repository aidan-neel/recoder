import { describe, expect, test } from 'bun:test';

import { isGroupOpen, parseOpenGroups, withOpenGroup } from '../../src/lib/settings/chooser-open-groups';

describe('parseOpenGroups', () => {
	test('keeps the headings of a stored list and drops anything else', () => {
		expect([...parseOpenGroups(['Claude Code', 4, null, 'Codex'])]).toEqual(['Claude Code', 'Codex']);
	});

	test('reads a stored value that is not a list as none open', () => {
		expect(parseOpenGroups({ 'Claude Code': true }).size).toBe(0);
		expect(parseOpenGroups(null).size).toBe(0);
	});
});

describe('isGroupOpen', () => {
	const remembered = new Set(['Codex']);

	test('opens only the remembered groups when there is no search', () => {
		expect(isGroupOpen('Codex', remembered, new Map(), false)).toBe(true);
		expect(isGroupOpen('Claude Code', remembered, new Map(), false)).toBe(false);
	});

	test('opens every listed group during a search', () => {
		expect(isGroupOpen('Claude Code', remembered, new Map(), true)).toBe(true);
	});

	test('keeps a group the viewer shut during the search shut', () => {
		expect(isGroupOpen('Claude Code', remembered, new Map([['Claude Code', false]]), true)).toBe(false);
	});
});

describe('withOpenGroup', () => {
	test('adds and removes a heading without changing the set it was given', () => {
		const before = new Set(['Codex']);

		expect([...withOpenGroup(before, 'Claude Code', true)].sort()).toEqual(['Claude Code', 'Codex']);
		expect([...withOpenGroup(before, 'Codex', false)]).toEqual([]);
		expect([...before]).toEqual(['Codex']);
	});
});
