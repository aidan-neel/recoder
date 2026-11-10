import { expect, test } from 'bun:test';
import { createProgressSink } from '../../../src/cli/output/progress-sink';

const NOW = new Date('2026-11-10T10:00:00.000Z');

function collect(format: 'none' | 'text' | 'ndjson') {
	const lines: string[] = [];

	return {
		lines,
		sink: createProgressSink(
			format,
			(line) => lines.push(line),
			() => NOW
		)
	};
}

test('ndjson writes every event as one JSON object stamped with the injected time', () => {
	const { lines, sink } = collect('ndjson');

	sink({ type: 'stage', stage: 'reviewing' });
	sink({ type: 'log', message: 'reading src/a.ts' });

	expect(lines.map((line) => JSON.parse(line))).toEqual([
		{ at: NOW.toISOString(), type: 'stage', stage: 'reviewing' },
		{ at: NOW.toISOString(), type: 'log', message: 'reading src/a.ts' }
	]);
});

test('text writes a line when the stage changes, not when it repeats', () => {
	const { lines, sink } = collect('text');

	sink({ type: 'stage', stage: 'checkout' });
	sink({ type: 'stage', stage: 'checkout' });
	sink({ type: 'stage', stage: 'reviewing' });

	expect(lines).toHaveLength(2);
});

test('text writes a line per new candidate count and ignores logs', () => {
	const { lines, sink } = collect('text');

	sink({ type: 'candidates', count: 4 });
	sink({ type: 'candidates', count: 4 });
	sink({ type: 'candidates', count: 6 });
	sink({ type: 'log', message: 'noise' });

	expect(lines).toHaveLength(2);
	expect(lines[1]).toContain('6');
});

test('none writes nothing', () => {
	const { lines, sink } = collect('none');

	sink({ type: 'stage', stage: 'reviewing' });
	sink({ type: 'candidates', count: 1 });

	expect(lines).toEqual([]);
});
