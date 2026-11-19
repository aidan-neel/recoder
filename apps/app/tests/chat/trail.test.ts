import { describe, expect, test } from 'bun:test';
import type { ChatTrailStep } from '@recoder/shared';

import {
	opensDetail,
	stepSpan,
	thoughtLabel,
	toolLine,
	workedLabel,
	workedSeconds,
	type ToolStep
} from '../../src/lib/chat/trail';

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
	test('counts from the reply start to its end, past the last step, so it never falls below the working count', () => {
		const seconds = workedSeconds(REPLY_START, '2026-11-13T10:00:20.900Z', [read('a', ['x.ts'])]);

		expect(seconds).toBe(22);
	});

	test('counts a reply saved without its end to the end of its last step', () => {
		const seconds = workedSeconds(REPLY_START, null, [thought('a', START), read('b', ['x.ts'])]);

		expect(seconds).toBe(14);
		expect(workedLabel(seconds)).toBe('Worked for 14s');
	});

	test('knows no time while a step still runs, and the line says only Worked', () => {
		const seconds = workedSeconds(REPLY_START, null, [read('a', ['x.ts']), run('b', 'running')]);

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

describe('stepSpan', () => {
	test('ends a finished step with how long it took, and a running one with nothing', () => {
		expect(stepSpan(read('a', ['a.ts']))).toBe('12s');
		expect(stepSpan(run('b', 'running'))).toBeNull();
	});
});

describe('opensDetail', () => {
	test('keeps every step to one line but opens the output of a command that failed', () => {
		expect(opensDetail(read('a', ['a.ts', 'b.ts']))).toBe(false);
		expect(opensDetail(run('b', 'done'))).toBe(false);
		expect(opensDetail(run('c', 'error'))).toBe(true);
	});
});
