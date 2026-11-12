import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { sendUsefulVote } from '../../src/lib/review/useful-sync';
import { flush } from '../fixtures';
import { confirmed, offered, restoreToasts, stubToasts, withdrawn } from './toast-stub';

const realFetch = globalThis.fetch;

/** Every write the client sent, as `METHOD path`. */
const sent: string[] = [];

/** How the server answers: counts the vote, answers 500, or answers on `release`. */
let answer: 'ok' | 'error' | 'held' = 'ok';

/** Lets the vote held last answer that it was counted. */
let release: () => void = () => {};

function respond(): Promise<Response> {
	if (answer === 'held') {
		return new Promise((resolve) => {
			release = () => resolve(new Response('{"useful":true}', { status: 200 }));
		});
	}

	return Promise.resolve(new Response('{}', { status: answer === 'ok' ? 200 : 500 }));
}

beforeEach(() => {
	sent.length = 0;
	answer = 'ok';
	stubToasts();

	globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
		sent.push(`${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`);

		return respond();
	}) as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = realFetch;
	restoreToasts();
});

describe('useful votes', () => {
	test('accepting or sending back marks a finding useful once, and switching between the two sends nothing', async () => {
		sendUsefulVote('rv-1', 'f1', 'open', 'accepted');
		sendUsefulVote('rv-1', 'f1', 'accepted', 'sent');
		sendUsefulVote('rv-1', 'f2', 'dismissed', 'sent');
		await flush();

		expect(sent).toEqual(['PUT /api/reviews/rv-1/useful/f1', 'PUT /api/reviews/rv-1/useful/f2']);
	});

	test('reopening takes the mark back, while dismissing and undoing a dismissal send no vote', async () => {
		sendUsefulVote('rv-1', 'f3', 'sent', 'open');
		sendUsefulVote('rv-1', 'f4', 'accepted', 'dismissed');
		sendUsefulVote('rv-1', 'f4', 'dismissed', 'open');
		await flush();

		expect(sent).toEqual(['DELETE /api/reviews/rv-1/useful/f3']);
	});

	test('a finding’s votes reach the server in order, each after the one before has answered', async () => {
		answer = 'held';
		sendUsefulVote('rv-1', 'f5', 'open', 'accepted');
		sendUsefulVote('rv-1', 'f5', 'accepted', 'open');
		await flush();

		expect(sent).toEqual(['PUT /api/reviews/rv-1/useful/f5']);

		release();
		await flush();

		expect(sent).toEqual(['PUT /api/reviews/rv-1/useful/f5', 'DELETE /api/reviews/rv-1/useful/f5']);
	});

	test('a vote the server refused offers Try again, which sends it once more and says when it lands', async () => {
		answer = 'error';
		sendUsefulVote('rv-1', 'f6', 'open', 'sent');
		await flush();

		answer = 'ok';
		offered[0]();
		await flush();

		expect(sent).toEqual(['PUT /api/reviews/rv-1/useful/f6', 'PUT /api/reviews/rv-1/useful/f6']);
		expect(confirmed).toEqual(['Saved']);
	});

	test('a newer vote takes away an older failure’s Try again, which then sends nothing', async () => {
		answer = 'error';
		sendUsefulVote('rv-1', 'f7', 'open', 'accepted');
		await flush();

		answer = 'ok';
		sendUsefulVote('rv-1', 'f7', 'accepted', 'open');
		await flush();
		offered[0]();
		await flush();

		expect(withdrawn).toEqual(['toast-1']);
		expect(sent).toEqual(['PUT /api/reviews/rv-1/useful/f7', 'DELETE /api/reviews/rv-1/useful/f7']);
	});
});
