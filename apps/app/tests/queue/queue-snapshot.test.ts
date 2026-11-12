import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Review } from '@recoder/shared';

import { queueEntry } from '../../src/lib/queue/queue';
import {
	clearSnapshot,
	keepMeasure,
	readSnapshot,
	saveSnapshot,
	SHAPE_SCRIPT,
	type QueueSnapshot
} from '../../src/lib/queue/queue-snapshot';
import { memoryStorage } from '../fixtures';
import { pull } from './fixtures';

const PULL = pull(1);

const REVIEW: Review = {
	id: 'rv-1',
	repoId: 'r1',
	prNumber: 1,
	headSha: 'sha1',
	status: 'passed',
	summary: null,
	findings: [{ id: 'f1', file: 'src/a.ts', line: 1, severity: 'error', message: 'A long message no row shows.' }],
	runs: [],
	source: 'github',
	prTitle: null,
	prUrl: null,
	createdAt: '2026-10-13T09:00:00Z',
	updatedAt: '2026-10-13T10:00:00Z'
};

function snapshot(at = Date.now()): QueueSnapshot {
	return {
		at,
		repos: [],
		entries: [queueEntry({ id: 'r1', name: 'acme/api' }, PULL, REVIEW, {})],
		missing: [],
		progress: {}
	};
}

/** Runs the skeleton's shape script as the server's HTML would, and returns the CSS variables it set on `<html>`. */
function runShapeScript(): Record<string, string> {
	const set: Record<string, string> = {};
	const style = { setProperty: (name: string, value: string) => void (set[name] = value) };

	const before = Object.getOwnPropertyDescriptor(globalThis, 'document');

	Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { style } } });

	try {
		new Function(SHAPE_SCRIPT)();
	} finally {
		if (before) Object.defineProperty(globalThis, 'document', before);
		else Reflect.deleteProperty(globalThis, 'document');
	}

	return set;
}

/** Reads a stored value back as the next page load would. */
function reload(stored: string | null): QueueSnapshot | null {
	clearSnapshot();

	if (stored !== null) localStorage.setItem('recoder.app.queue.v1', stored);

	return readSnapshot();
}

const SHAPE_KEY = 'recoder.app.queue-shape.v1';

/** A repository whose pull requests did not load, which makes one note under the headline. */
const MISSING = { name: 'acme/web', provider: 'github', kind: 'auth', text: 'Rejected.' } as const;

/** Sets the window's width, which the measured parts of a shape hold at. */
function widen(width: number): void {
	Object.assign(globalThis, { innerWidth: width, window: { innerWidth: width } });
}

beforeEach(() => {
	Object.assign(globalThis, { localStorage: memoryStorage() });
	widen(1440);
	clearSnapshot();
});

afterEach(() => {
	Reflect.deleteProperty(globalThis, 'window');
	Reflect.deleteProperty(globalThis, 'innerWidth');
});

describe('queue snapshot', () => {
	test('a saved list comes back on the next load with each review cut to what its row reads', () => {
		saveSnapshot(snapshot());

		const back = reload(localStorage.getItem('recoder.app.queue.v1'));

		expect(back?.entries.map((entry) => entry.key)).toEqual(['r1#1']);
		expect(back?.entries[0].review?.findings).toEqual([{ id: 'f1', severity: 'error' }]);
	});

	test('a saved list that is a day old, from another server or edited by hand is not painted', () => {
		saveSnapshot(snapshot());

		const saved = JSON.parse(localStorage.getItem('recoder.app.queue.v1') ?? '{}') as Record<string, unknown>;

		expect(reload(JSON.stringify({ ...saved, at: Date.now() - 25 * 60 * 60 * 1000 }))).toBeNull();
		expect(reload(JSON.stringify({ ...saved, api: 'http://elsewhere:3001' }))).toBeNull();
		expect(reload(JSON.stringify({ ...saved, entries: [{ key: 'r1#1' }] }))).toBeNull();
		expect(reload('{not json')).toBeNull();
	});

	test('the shape script hides the note lines only for a list that had none, and leaves a missing or edited shape alone', () => {
		saveSnapshot(snapshot());

		expect(runShapeScript()).toEqual({
			'--queue-skeleton-rows': '1',
			'--queue-skeleton-notes': '0',
			'--queue-skeleton-if-notes': 'none'
		});

		saveSnapshot({
			...snapshot(),
			missing: [{ name: 'acme/web', provider: 'github', kind: 'auth', text: 'Rejected.' }]
		});

		expect(runShapeScript()).toEqual({ '--queue-skeleton-rows': '1', '--queue-skeleton-notes': '1' });

		localStorage.setItem('recoder.app.queue-shape.v1', '{"rows":2,"notes":9}');

		expect(runShapeScript()).toEqual({});

		localStorage.removeItem('recoder.app.queue-shape.v1');

		expect(runShapeScript()).toEqual({});
	});

	test('the headline measured on screen applies only at its window width, the notes height on its side of 450px, in rem', () => {
		saveSnapshot({ ...snapshot(), missing: [MISSING] });
		keepMeasure({ brief: 2, notes: 1, notesHeight: 36 });

		expect(runShapeScript()).toEqual({
			'--queue-skeleton-rows': '1',
			'--queue-skeleton-notes': '1',
			'--queue-skeleton-brief': '2',
			'--queue-skeleton-notes-height': '2.25rem'
		});

		widen(1280);

		expect(runShapeScript()).toEqual({
			'--queue-skeleton-rows': '1',
			'--queue-skeleton-notes': '1',
			'--queue-skeleton-notes-height': '2.25rem'
		});

		widen(449);

		expect(runShapeScript()).toEqual({ '--queue-skeleton-rows': '1', '--queue-skeleton-notes': '1' });
	});

	test('a notes height is kept only for the notes the shape counts, and dropped when their count changes', () => {
		saveSnapshot({ ...snapshot(), missing: [MISSING] });
		keepMeasure({ brief: 1, notes: 2, notesHeight: 60 });

		expect(JSON.parse(localStorage.getItem(SHAPE_KEY) ?? '{}')).toEqual({ rows: 1, notes: 1, width: 1440, brief: 1 });

		keepMeasure({ brief: 1, notes: 1, notesHeight: 36 });
		saveSnapshot(snapshot());

		expect(JSON.parse(localStorage.getItem(SHAPE_KEY) ?? '{}')).toEqual({ rows: 1, notes: 0, width: 1440, brief: 1 });
	});

	test('measured parts that are malformed are skipped and the counts still apply', () => {
		localStorage.setItem(SHAPE_KEY, '{"rows":2,"notes":1,"width":1440,"brief":9,"notesHeight":-4}');

		expect(runShapeScript()).toEqual({ '--queue-skeleton-rows': '2', '--queue-skeleton-notes': '1' });

		localStorage.setItem(SHAPE_KEY, '{"rows":2,"notes":1,"width":1440,"brief":2,"notesHeight":"36"}');

		expect(runShapeScript()).toEqual({
			'--queue-skeleton-rows': '2',
			'--queue-skeleton-notes': '1',
			'--queue-skeleton-brief': '2'
		});
	});
});
