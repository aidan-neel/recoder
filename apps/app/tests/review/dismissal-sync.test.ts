import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import * as sync from '../../src/lib/review/dismissal-sync';
import type { DecisionState } from '../../src/lib/review/surface';
import { flush, memoryStorage } from '../fixtures';
import { confirmed, offered, restoreToasts, stubToasts, withdrawn } from './toast-stub';

const { retryDismissal, sendDismissal } = sync;

/** The sync's exports, from the copy every test shares or from a reloaded one. */
type Sync = typeof sync;

/** How many times a test has loaded the sync afresh, so each reload is a new copy. */
let reloads = 0;

const realFetch = globalThis.fetch;

/** Every write the client sent, as `METHOD path`. */
const sent: string[] = [];

/** How the server answers a dismissal: stores it, answers 500, runs out of time, never answers, or answers on `release`. */
let dismissAnswer: 'ok' | 'error' | 'timeout' | 'hang' | 'held' = 'ok';

/** Lets the dismissal held last answer that it stored it. */
let release: () => void = () => {};

/** How the server answers a restore: takes the dismissal away, or answers 500. */
let restoreAnswer: 'ok' | 'error' = 'ok';

/** The server's answer to a dismissal, as `dismissAnswer` says. A timeout rejects the way the request's own timer does. */
function answerDismissal(): Promise<Response> {
	if (dismissAnswer === 'hang') return new Promise(() => {});

	if (dismissAnswer === 'held') {
		return new Promise((resolve) => {
			release = () => resolve(new Response('{}', { status: 200 }));
		});
	}

	if (dismissAnswer === 'timeout') return Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'));

	const ok = dismissAnswer === 'ok';

	return Promise.resolve(
		new Response(JSON.stringify(ok ? {} : { error: 'database is locked' }), { status: ok ? 200 : 500 })
	);
}

/**
 * What a finding's Not saved mark reads from the sync while the decision here
 * is `state`: failed, retrying, or saved once nothing is missing.
 */
function mark(findingId: string, state: DecisionState = 'dismissed', from: Sync = sync): string {
	function Probe() {
		return from.useUnsavedDismissal('rv-1', findingId, state) ?? 'saved';
	}

	return renderToStaticMarkup(createElement(Probe));
}

/** Where a finding's write stands for its decision note: saving, failed, retrying, or saved once nothing is pending. */
function phase(findingId: string, state: DecisionState = 'dismissed'): string {
	function Probe() {
		return sync.useDismissalPhase('rv-1', findingId, state) ?? 'saved';
	}

	return renderToStaticMarkup(createElement(Probe));
}

/** A new copy of the sync, as a reload loads it: nothing in memory, only what storage kept. */
async function reload(): Promise<Sync> {
	reloads += 1;

	return (await import(`../../src/lib/review/dismissal-sync.ts?reload=${reloads}`)) as Sync;
}

beforeEach(() => {
	sent.length = 0;
	dismissAnswer = 'ok';
	restoreAnswer = 'ok';
	globalThis.localStorage = memoryStorage();
	stubToasts();

	globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
		const method = init?.method ?? 'GET';

		sent.push(`${method} ${new URL(String(input)).pathname}`);

		if (method === 'POST') return answerDismissal();

		return Promise.resolve(
			new Response('{}', { status: method === 'DELETE' && restoreAnswer === 'error' ? 500 : 200 })
		);
	}) as typeof fetch;
});

afterEach(() => {
	jest.useRealTimers();
	globalThis.fetch = realFetch;
	Reflect.deleteProperty(globalThis, 'localStorage');
	restoreToasts();
});

describe('dismissal sync', () => {
	test('undoing a dismissal the server never stored sends no restore', async () => {
		dismissAnswer = 'error';
		sendDismissal('rv-1', 'f1', 'open', 'dismissed');
		sendDismissal('rv-1', 'f1', 'dismissed', 'open');
		await flush();

		expect(sent).toEqual(['POST /api/reviews/rv-1/dismissals']);
	});

	test('undoing a stored dismissal restores it on the server', async () => {
		sendDismissal('rv-1', 'f2', 'open', 'dismissed');
		sendDismissal('rv-1', 'f2', 'dismissed', 'open');
		await flush();

		expect(sent).toEqual(['POST /api/reviews/rv-1/dismissals', 'DELETE /api/reviews/rv-1/dismissals/f2']);
	});

	test('a dismissal that ran out of time lets the next write go, and undoing it restores it since it may have landed', async () => {
		dismissAnswer = 'timeout';
		sendDismissal('rv-1', 'f3', 'open', 'dismissed');
		sendDismissal('rv-1', 'f3', 'dismissed', 'open');
		await flush();

		expect(sent).toEqual(['POST /api/reviews/rv-1/dismissals', 'DELETE /api/reviews/rv-1/dismissals/f3']);
	});

	test('a write the server never answers holds back only its own finding', async () => {
		dismissAnswer = 'hang';
		sendDismissal('rv-1', 'f4', 'open', 'dismissed');
		sendDismissal('rv-1', 'f4', 'dismissed', 'open');
		await flush();

		dismissAnswer = 'ok';
		sendDismissal('rv-1', 'f5', 'open', 'dismissed');
		await flush();

		expect(sent).toEqual(['POST /api/reviews/rv-1/dismissals', 'POST /api/reviews/rv-1/dismissals']);
	});

	test('a dismissal the server refused offers Try again, which sends it once more and says when it lands', async () => {
		dismissAnswer = 'error';
		sendDismissal('rv-1', 'f6', 'open', 'dismissed');
		await flush();

		expect(mark('f6')).toBe('failed');

		dismissAnswer = 'ok';
		offered[0]();

		expect(mark('f6')).toBe('retrying');

		await flush();
		offered[0]();
		await flush();

		expect(offered).toHaveLength(1);
		expect(sent).toEqual(['POST /api/reviews/rv-1/dismissals', 'POST /api/reviews/rv-1/dismissals']);
		expect(confirmed).toEqual(['Saved']);
		expect(mark('f6')).toBe('saved');
	});

	test('Try again while its write is on its way sends nothing more, and a retry that fails is marked failed again', async () => {
		dismissAnswer = 'error';
		sendDismissal('rv-1', 'f9', 'open', 'dismissed');
		await flush();

		retryDismissal('rv-1', 'f9');
		retryDismissal('rv-1', 'f9');
		offered[0]();
		await flush();

		expect(sent).toEqual(['POST /api/reviews/rv-1/dismissals', 'POST /api/reviews/rv-1/dismissals']);
		expect(offered).toHaveLength(2);
		expect(mark('f9')).toBe('failed');
	});

	test('a newer change takes the Try again away, so it never sends the decision the person changed', async () => {
		dismissAnswer = 'error';
		sendDismissal('rv-1', 'f7', 'open', 'dismissed');
		await flush();

		sendDismissal('rv-1', 'f7', 'dismissed', 'open');

		expect(mark('f7', 'open')).toBe('saved');

		offered[0]();
		retryDismissal('rv-1', 'f7');
		await flush();

		expect(withdrawn).toEqual(['toast-1']);
		expect(sent).toEqual(['POST /api/reviews/rv-1/dismissals']);
	});

	test('a write that fails after a newer change for its finding raises nothing, since that change settles it', async () => {
		dismissAnswer = 'error';
		sendDismissal('rv-1', 'f8', 'open', 'dismissed');
		sendDismissal('rv-1', 'f8', 'dismissed', 'open');
		await flush();

		expect(offered).toEqual([]);
		expect(mark('f8', 'open')).toBe('saved');
	});

	test('a retry the person overtook with a newer change leaves no mark when it fails', async () => {
		dismissAnswer = 'error';
		sendDismissal('rv-1', 'f10', 'open', 'dismissed');
		await flush();

		retryDismissal('rv-1', 'f10');
		sendDismissal('rv-1', 'f10', 'dismissed', 'open');
		await flush();

		expect(offered).toHaveLength(1);
		expect(mark('f10', 'open')).toBe('saved');
	});

	test('a failed dismissal is still marked after a reload, and its Try again sends it', async () => {
		dismissAnswer = 'error';
		sendDismissal('rv-1', 'f11', 'open', 'dismissed');
		await flush();

		const reloaded = await reload();

		expect(mark('f11', 'dismissed', reloaded)).toBe('failed');

		dismissAnswer = 'ok';
		reloaded.retryDismissal('rv-1', 'f11');
		await flush();

		expect(sent).toEqual(['POST /api/reviews/rv-1/dismissals', 'POST /api/reviews/rv-1/dismissals']);
		expect(mark('f11', 'dismissed', reloaded)).toBe('saved');
		expect(mark('f11', 'dismissed', await reload())).toBe('saved');
	});

	test('a failed restore kept across a reload sends the restore when tried again', async () => {
		sendDismissal('rv-1', 'f12', 'open', 'dismissed');
		await flush();

		restoreAnswer = 'error';
		sendDismissal('rv-1', 'f12', 'dismissed', 'open');
		await flush();

		const reloaded = await reload();

		expect(mark('f12', 'open', reloaded)).toBe('failed');

		restoreAnswer = 'ok';
		reloaded.retryDismissal('rv-1', 'f12');
		await flush();

		expect(sent.slice(1)).toEqual([
			'DELETE /api/reviews/rv-1/dismissals/f12',
			'DELETE /api/reviews/rv-1/dismissals/f12'
		]);

		expect(mark('f12', 'open', reloaded)).toBe('saved');
	});

	test('a kept failure shows nothing on a decision it no longer describes, as after a new push', async () => {
		dismissAnswer = 'error';
		sendDismissal('rv-1', 'f13', 'open', 'dismissed');
		await flush();

		const reloaded = await reload();

		expect(mark('f13', 'dismissed', reloaded)).toBe('failed');
		expect(mark('f13', 'open', reloaded)).toBe('saved');
		expect(mark('f13', 'accepted', reloaded)).toBe('saved');
	});

	test('a newer change in another tab forgets the failure it kept, so a reload shows none', async () => {
		const otherTab = await reload();

		expect(mark('f14', 'open', otherTab)).toBe('saved');

		dismissAnswer = 'error';
		sendDismissal('rv-1', 'f14', 'open', 'dismissed');
		await flush();

		otherTab.sendDismissal('rv-1', 'f14', 'dismissed', 'open');
		await flush();

		expect(mark('f14', 'dismissed', await reload())).toBe('saved');
	});

	test('a write still on its way after 300ms reads as saving on its note, not as unsaved', async () => {
		jest.useFakeTimers();
		dismissAnswer = 'held';
		sendDismissal('rv-1', 'f15', 'open', 'dismissed');
		await flush();
		jest.advanceTimersByTime(299);

		expect(phase('f15')).toBe('saved');

		jest.advanceTimersByTime(1);

		expect(phase('f15')).toBe('saving');
		expect(mark('f15')).toBe('saved');
	});

	test('a Saving mark stays 300ms once shown, even when its write lands at once, so it never blinks', async () => {
		jest.useFakeTimers();
		dismissAnswer = 'held';
		sendDismissal('rv-1', 'f18', 'open', 'dismissed');
		await flush();
		jest.advanceTimersByTime(300);
		release();
		await flush();
		jest.advanceTimersByTime(299);
		await flush();

		expect(phase('f18')).toBe('saving');

		jest.advanceTimersByTime(1);
		await flush();

		expect(phase('f18')).toBe('saved');
		expect(confirmed).toEqual([]);
	});

	test('a change made while a landed write’s Saving mark holds keeps its own mark when that hold ends', async () => {
		jest.useFakeTimers();
		dismissAnswer = 'held';
		sendDismissal('rv-1', 'f19', 'open', 'dismissed');
		await flush();
		jest.advanceTimersByTime(300);
		release();
		await flush();

		restoreAnswer = 'error';
		sendDismissal('rv-1', 'f19', 'dismissed', 'open');
		await flush();
		jest.advanceTimersByTime(300);
		await flush();

		expect(phase('f19', 'open')).toBe('failed');
	});

	test('a write that settles within 300ms never reads as saving afterwards', async () => {
		jest.useFakeTimers();
		sendDismissal('rv-1', 'f16', 'open', 'dismissed');
		await flush();

		dismissAnswer = 'error';
		sendDismissal('rv-1', 'f17', 'open', 'dismissed');
		await flush();
		jest.advanceTimersByTime(400);

		expect(phase('f16')).toBe('saved');
		expect(phase('f17')).toBe('failed');
	});
});
