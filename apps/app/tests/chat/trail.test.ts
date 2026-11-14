import { describe, expect, test } from 'bun:test';
import type { ChatTrailStep } from '@recoder/shared';

import { thoughtLabel, toolLine, workedLabel, workedSeconds, type ToolStep } from '../../src/lib/chat/trail';

const REPLY_START = '2026-11-13T09:59:58.000Z';
const START = '2026-11-13T10:00:00.000Z';
const END = '2026-11-13T10:00:12.000Z';

function thought(id: string, endedAt?: string): Extract<ChatTrailStep, { kind: 'thought' }> {
	return { id, kind: 'thought', title: '', text: 'idea', startedAt: START, ...(endedAt ? { endedAt } : {}) };
}

function read(id: string, paths: string[]): ToolStep {
	return { id, kind: 'read', status: 'done', files: paths.map((path) => ({ path })), startedAt: START, endedAt: END };
}

function run(id: string, status: 'running' | 'done' | 'error'): ToolStep {
	return { id, kind: 'run', command: 'bun test', status, startedAt: START };
}

describe('toolLine', () => {
	test('names a lone file by its path and several by their count', () => {
		expect(toolLine(read('a', ['src/a.ts']))).toMatchObject({ verb: 'Read', target: 'src/a.ts' });
		expect(toolLine(read('b', ['a.ts', 'b.ts']))).toMatchObject({ verb: 'Read 2 files', target: null });
	});

	test('words a failed command as failed', () => {
		expect(toolLine(run('a', 'error'))).toMatchObject({ verb: 'Failed', target: 'bun test' });
	});
});

describe('workedSeconds', () => {
	test('counts from the reply start to the end of its last step', () => {
		const seconds = workedSeconds(REPLY_START, [thought('a', START), read('b', ['x.ts'])]);

		expect(seconds).toBe(14);
		expect(workedLabel(seconds)).toBe('Worked for 14s');
	});

	test('knows no time while a step still runs, and the line says only Worked', () => {
		const seconds = workedSeconds(REPLY_START, [read('a', ['x.ts']), run('b', 'running')]);

		expect(seconds).toBeNull();
		expect(workedLabel(seconds)).toBe('Worked');
	});
});

describe('thoughtLabel', () => {
	test('says how long an untitled thought took, and Thinking while it goes', () => {
		expect(thoughtLabel(thought('a', END))).toBe('Thought for 12s');
		expect(thoughtLabel(thought('b'))).toBe('Thinking');
	});

	test('uses the title the provider gave', () => {
		expect(thoughtLabel({ ...thought('a', END), title: 'Framing the question' })).toBe('Framing the question');
	});
});
