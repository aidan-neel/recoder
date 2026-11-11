import { afterEach, expect, test } from 'bun:test';
import { writeStderrLine } from '../../../src/cli/output/streams';
import { LiveRegion } from '../../../src/cli/terminal/live-region';

const UP_TWO_LINES = '\u001b[2A';

const SHOW_CURSOR = '\u001b[?25h';

const regions: LiveRegion[] = [];

afterEach(() => {
	for (const region of regions.splice(0)) region.close();
});

/** A region on a fake terminal of the given size, and everything written to that terminal. */
function openRegion(size: { columns: number; rows: number } = { columns: 40, rows: 10 }) {
	const written: string[] = [];
	const region = new LiveRegion({ write: (text) => written.push(text), ...size }, '…');

	regions.push(region);

	return { region, written, last: () => written[written.length - 1] };
}

test('a redraw moves up over the lines drawn before and erases them', () => {
	const { region, last } = openRegion();

	region.render(['one', 'two']);
	region.render(['three']);

	expect(last()).toContain(UP_TWO_LINES);
	expect(last()).toContain('three\n');
	expect(last()).not.toContain('one');
});

test('a line wider than the terminal is cut, since a wrapped line would break the next redraw', () => {
	const { region, last } = openRegion({ columns: 10, rows: 10 });

	region.render(['abcdefghijklmnopqrstuvwxyz']);

	expect(last()).toContain('abcdefgh…\n');
});

test('more lines than the terminal has rows are cut to what fits', () => {
	const { region, last } = openRegion({ columns: 40, rows: 3 });

	region.render(['one', 'two', 'three', 'four']);

	expect(last()).toContain('two\n');
	expect(last()).not.toContain('three');
});

test('a line written to standard error while the region is open is printed above it, and the region redrawn', () => {
	const { region, last } = openRegion();

	region.render(['progress']);
	writeStderrLine('recoder: a warning');

	expect(last().indexOf('recoder: a warning')).toBeLessThan(last().indexOf('progress'));
});

test('closing erases the region, shows the cursor again and gives standard error back', () => {
	const { region, written, last } = openRegion();

	region.render(['progress']);
	region.close();

	expect(last()).toContain(SHOW_CURSOR);

	const count = written.length;

	region.render(['late']);

	expect(written).toHaveLength(count);
});
