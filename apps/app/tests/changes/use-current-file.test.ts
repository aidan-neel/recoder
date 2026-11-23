import { describe, expect, test } from 'bun:test';

import { cardAtReadingLine } from '../../src/lib/changes/use-current-file';

/** A scroller 900px tall at the top of the page, holding cards whose tops sit at `tops`; its reading line is at 300. */
function scroller(tops: number[]) {
	const cards = tops.map((top, index) => ({ id: index, getBoundingClientRect: () => ({ top }) }));

	const host = {
		clientHeight: 900,
		getBoundingClientRect: () => ({ top: 0 }),
		querySelectorAll: () => cards
	};

	return { host: host as unknown as HTMLElement, cards };
}

/** The index of the card the reading line falls in, or null. */
function readAt(tops: number[]): number | null {
	const { host } = scroller(tops);
	const card = cardAtReadingLine(host, 'file') as unknown as { id: number } | null;

	return card ? card.id : null;
}

describe('cardAtReadingLine', () => {
	test('picks the last card whose top has passed the reading line', () => {
		expect(readAt([0, 120, 250, 300, 301, 900, 2000])).toBe(3);
		expect(readAt([-4000, -2000, -10, 500, 1200])).toBe(2);
	});

	test('picks the first card while no card has reached the line', () => {
		expect(readAt([400, 800, 1600])).toBe(0);
	});

	test('picks the last card once every card has passed the line', () => {
		expect(readAt([-900, -400, 10, 299])).toBe(3);
	});

	test('is null with no cards', () => {
		expect(readAt([])).toBeNull();
	});

	test('measures a handful of cards in a long list, not every card above the line', () => {
		const tops = Array.from({ length: 1000 }, (_, index) => index * 100 - 60_000);
		const { host, cards } = scroller(tops);
		let measured = 0;

		for (const card of cards) {
			const read = card.getBoundingClientRect;

			card.getBoundingClientRect = () => {
				measured++;

				return read();
			};
		}

		expect((cardAtReadingLine(host, 'file') as unknown as { id: number }).id).toBe(603);
		expect(measured).toBeLessThan(20);
	});
});
