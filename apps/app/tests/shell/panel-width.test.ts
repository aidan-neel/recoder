import { describe, expect, test } from 'bun:test';

import { PANEL_WIDTHS, parseStoredWidth, widthToRem } from '../../src/lib/shell/panel-width';

const SIDEBAR = PANEL_WIDTHS.sidebar;

describe('parseStoredWidth', () => {
	test('keeps a saved width inside the range', () => {
		expect(parseStoredWidth('300', SIDEBAR)).toBe(300);
		expect(parseStoredWidth('50', SIDEBAR)).toBe(SIDEBAR.min);
		expect(parseStoredWidth('9000', SIDEBAR)).toBe(SIDEBAR.max);
	});

	test('falls back for nothing saved or text that is not a whole number', () => {
		for (const text of [null, '', 'wide', '-300', '300.5', '1e3', '300px', '12345']) {
			expect(parseStoredWidth(text, SIDEBAR)).toBe(SIDEBAR.fallback);
		}
	});
});

describe('widthToRem', () => {
	test('divides by the base font size', () => {
		expect(widthToRem(248)).toBe('15.5rem');
	});
});
