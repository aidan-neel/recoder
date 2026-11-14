import { describe, expect, test } from 'bun:test';

import { clampWidth, draggedWidth, keyWidth } from '../../src/components/display/resize-math';

const RANGE = { min: 200, max: 400 };

describe('clampWidth', () => {
	test('holds a width inside the range and rounds it', () => {
		expect(clampWidth(100, RANGE)).toBe(200);
		expect(clampWidth(999, RANGE)).toBe(400);
		expect(clampWidth(247.6, RANGE)).toBe(248);
	});
});

describe('keyWidth', () => {
	test('arrows step the width and stop at the ends', () => {
		expect(keyWidth('ArrowRight', 248, RANGE, 16)).toBe(264);
		expect(keyWidth('ArrowLeft', 248, RANGE, 16)).toBe(232);
		expect(keyWidth('ArrowRight', 395, RANGE, 16)).toBe(400);
		expect(keyWidth('ArrowLeft', 205, RANGE, 16)).toBe(200);
	});

	test('Home and End go to the ends', () => {
		expect(keyWidth('Home', 248, RANGE, 16)).toBe(200);
		expect(keyWidth('End', 248, RANGE, 16)).toBe(400);
	});

	test('any other key asks for nothing', () => {
		expect(keyWidth('Enter', 248, RANGE, 16)).toBeNull();
	});
});

describe('draggedWidth', () => {
	test('turns screen px into base px through the root font scale', () => {
		expect(draggedWidth(248, 60, 1.25, RANGE)).toBe(296);
		expect(draggedWidth(248, -500, 1, RANGE)).toBe(200);
	});
});
