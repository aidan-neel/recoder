import { expect, test } from 'bun:test';

import { pickSection } from '~/lib/use-current-section';

const SECTIONS = ['add-it-to-your-agent', 'tools', 'a-review-start-to-finish'];

/** The MCP page at its end on a tall window: Tools and the section after it are short, so neither reaches the line. */
const STRANDED = [
	{ id: SECTIONS[0], top: -400 },
	{ id: SECTIONS[1], top: 330 },
	{ id: SECTIONS[2], top: 720 }
];

test('a chosen section the page cannot lift to the reading line stays the current one at the end of the page', () => {
	expect(pickSection(STRANDED, true, 'tools')).toBe('tools');
});

test('a chosen section that just reaches the reading line at the end of the page stays the current one', () => {
	const sections = [
		{ id: SECTIONS[0], top: -400 },
		{ id: SECTIONS[1], top: 60 },
		{ id: SECTIONS[2], top: 500 }
	];

	expect(pickSection(sections, true, 'tools')).toBe('tools');
});

test('at the end of the page with no section chosen, the last section is the current one', () => {
	expect(pickSection(STRANDED, true, null)).toBe('a-review-start-to-finish');
});

test('a chosen section the reader has scrolled past does not hold the end of the page', () => {
	expect(pickSection(STRANDED, true, 'add-it-to-your-agent')).toBe('a-review-start-to-finish');
});

test('before the end of the page the last heading past the reading line is the current one', () => {
	const sections = [
		{ id: SECTIONS[0], top: -400 },
		{ id: SECTIONS[1], top: 40 },
		{ id: SECTIONS[2], top: 600 }
	];

	expect(pickSection(sections, false, 'a-review-start-to-finish')).toBe('tools');
});
