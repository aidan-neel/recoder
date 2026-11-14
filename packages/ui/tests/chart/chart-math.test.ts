import { describe, expect, test } from 'bun:test';

import {
	dayTip,
	formatCompact,
	formatShare,
	nearestPoint,
	nearestSeries,
	niceTicks,
	smoothLine,
	tickIndexes
} from '../../src/components/chart/chart-math';

describe('niceTicks', () => {
	test('steps by a round number up to the first multiple above the maximum', () => {
		expect(niceTicks(5_300_000_000)).toEqual([0, 2e9, 4e9, 6e9]);
		expect(niceTicks(87)).toEqual([0, 50, 100]);
	});

	test('keeps a maximum that is already a multiple as the top tick', () => {
		expect(niceTicks(100, 4)).toEqual([0, 50, 100]);
	});

	test('gives an empty chart a 0 to 1 axis', () => {
		expect(niceTicks(0)).toEqual([0, 1]);
	});
});

describe('formatCompact', () => {
	test('keeps three significant digits and drops trailing zeros', () => {
		expect(formatCompact(42_800_000_000)).toBe('42.8B');
		expect(formatCompact(1_080_000_000)).toBe('1.08B');
		expect(formatCompact(733_400_000)).toBe('733M');
		expect(formatCompact(2_000_000_000)).toBe('2B');
	});

	test('moves up a suffix when rounding reaches 1,000', () => {
		expect(formatCompact(999_600)).toBe('1M');
	});

	test('writes small counts whole and zero as 0', () => {
		expect(formatCompact(0)).toBe('0');
		expect(formatCompact(842)).toBe('842');
	});
});

describe('tickIndexes', () => {
	test('includes both ends and spreads the rest', () => {
		expect(tickIndexes(31, 3)).toEqual([0, 15, 30]);
	});

	test('uses fewer labels when that makes every gap the same size', () => {
		expect(tickIndexes(7, 5)).toEqual([0, 2, 4, 6]);
	});

	test('never asks for more labels than points', () => {
		expect(tickIndexes(2, 5)).toEqual([0, 1]);
		expect(tickIndexes(1, 5)).toEqual([0]);
		expect(tickIndexes(0, 5)).toEqual([]);
	});
});

describe('nearestPoint', () => {
	test('snaps the pointer to the closest day', () => {
		expect(nearestPoint(0, 0, 100, 5)).toBe(0);
		expect(nearestPoint(12.4, 0, 100, 5)).toBe(0);
		expect(nearestPoint(12.6, 0, 100, 5)).toBe(1);
		expect(nearestPoint(100, 0, 100, 5)).toBe(4);
	});

	test('is null beside the plot, where the axis labels sit', () => {
		expect(nearestPoint(-1, 0, 100, 5)).toBeNull();
		expect(nearestPoint(101, 0, 100, 5)).toBeNull();
		expect(nearestPoint(10, 0, 100, 0)).toBeNull();
	});
});

describe('nearestSeries', () => {
	const marks = [
		{ id: 'a', y: 40 },
		{ id: 'b', y: 60 },
		{ id: 'c', y: 61 }
	];

	test('picks the line whose mark is nearest the pointer', () => {
		expect(nearestSeries(marks, 44, 18)).toBe('a');
		expect(nearestSeries(marks, 62, 18)).toBe('c');
	});

	test('gives a tie to the line listed first', () => {
		expect(nearestSeries(marks, 50, 18)).toBe('a');
	});

	test('is null when no mark is within reach, so open space highlights nothing', () => {
		expect(nearestSeries(marks, 100, 18)).toBeNull();
		expect(nearestSeries([], 50, 18)).toBeNull();
	});
});

/** Every y the curve's control points reach, so a test can see how far it swings. */
function controlYs(path: string): number[] {
	return [...path.matchAll(/[\d.-]+,([\d.-]+)/g)].map((match) => Number(match[1]));
}

describe('smoothLine', () => {
	test('never swings past a peak or below a run of zeros', () => {
		const points = [0, 0, 80, 0, 0].map((y, index) => ({ x: index * 10, y: 100 - y }));

		const ys = controlYs(smoothLine(points));

		expect(Math.min(...ys)).toBe(20);
		expect(Math.max(...ys)).toBe(100);
	});
});

describe('dayTip', () => {
	const series = [
		{ id: 'a', label: 'A', color: 'red', values: [5, 0] },
		{ id: 'b', label: 'B', color: 'blue', values: [9, 0] },
		{ id: 'c', label: 'C', color: 'green', values: [0, 0] },
		{ id: 'd', label: 'D', color: 'gray', values: [1, 0] }
	];

	test('lists the series with a value, biggest first, and totals them', () => {
		const tip = dayTip(series, 0);

		expect(tip.rows.map((row) => row.id)).toEqual(['b', 'a', 'd']);
		expect(tip.total).toBe(15);
		expect(tip.rest).toBeNull();
	});

	test('folds the smallest beyond the row limit into one count and sum', () => {
		const tip = dayTip(series, 0, 2);

		expect(tip.rows.map((row) => row.id)).toEqual(['b', 'a']);
		expect(tip.rest).toEqual({ count: 1, value: 1 });
		expect(tip.total).toBe(15);
	});

	test('is empty for a day with nothing', () => {
		expect(dayTip(series, 1)).toEqual({ total: 0, rows: [], rest: null });
	});
});

describe('formatShare', () => {
	test('writes one decimal and marks a sliver instead of rounding it to nothing', () => {
		expect(formatShare(0.9071)).toBe('90.7%');
		expect(formatShare(0.0002)).toBe('<0.1%');
		expect(formatShare(0)).toBe('0.0%');
	});
});
