import type { FailureAction, UsageLimit } from '@recoder/shared';

import { plainError } from './server-error';

/** The review server. Every call is cross-origin; the server answers `Access-Control-Allow-Origin: *`. */
export const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

interface ErrorBody {
	error?: string;
	action?: FailureAction;
	usageLimit?: UsageLimit;
	kind?: string;
}

/** A failed request, carrying the server's message and any way out it offered. */
export class ApiError extends Error {
	override name = 'ApiError';

	constructor(
		message: string,
		readonly status: number,
		readonly action?: FailureAction,
		readonly usageLimit?: UsageLimit,
		readonly kind?: string
	) {
		super(message);
	}
}

/**
 * A request that never reached the server: it is not running, or the network
 * dropped. Only this reads as offline; an error thrown while the page reads a
 * response it did get is a bug, not a missing server.
 */
export class NetworkError extends Error {
	override name = 'NetworkError';
}

/** A request the server did not answer within its time limit. The server may still be up; it did not answer in time. */
export class TimeoutError extends Error {
	override name = 'TimeoutError';
}

/**
 * A stream that failed after the server answered: its own error frame, whose
 * message is the server's words, or a stream that ended before its last frame.
 */
export class StreamError extends Error {
	override name = 'StreamError';
}

/** True when the request never reached the server. */
export function isOffline(error: unknown): boolean {
	return error instanceof NetworkError;
}

/** The one sentence for a server that never answered. */
export const OFFLINE_TEXT = 'Can’t reach the review server.';

/** The line under {@link OFFLINE_TEXT}. It names no next step, since a Try again button sits beside it. */
export const OFFLINE_DETAIL = 'It may not be running.';

/** The one sentence for a request that ran out of time. */
const TIMEOUT_TEXT = 'The review server took too long to answer.';

/**
 * The one sentence for an answer the page could not read, such as a body that
 * is not JSON. It follows titles like "Couldn’t load the queue.", so it never
 * says "couldn’t" itself.
 */
const UNREADABLE_TEXT = 'The server’s answer wasn’t readable.';

/**
 * What a failure says when it carries no reason a person can use. It names
 * neither the server (the sentence before it often does) nor trying again
 * (a Try again button often sits beside it). A failure toast with no button
 * says the next step instead (see `errorToast`).
 */
export const NO_REASON_TEXT = 'No reason was given.';

/**
 * What kind of failure an error is, so a caller can pick its copy and its way
 * out: `offline` never reached the server, `timeout` got no answer in time,
 * `auth` was refused for a missing or rejected sign-in (a forge token, a
 * provider key), `server` is any other error the server answered with (its
 * message is the error's), and `other` is anything else, such as a bug
 * reading an answer or a request the caller aborted.
 */
export type FailureKind = 'offline' | 'timeout' | 'auth' | 'server' | 'other';

/** The kind of a failed call's error; a forge or provider that refused a token (`kind: 'auth'`, or a 401) reads as `auth`. */
export function failureKind(error: unknown): FailureKind {
	if (error instanceof NetworkError) return 'offline';
	if (error instanceof TimeoutError) return 'timeout';
	if (!(error instanceof ApiError)) return 'other';

	return error.kind === 'auth' || error.status === 401 ? 'auth' : 'server';
}

/** True for an abort the caller asked for, which needs no words of its own. */
function isAbort(error: unknown): boolean {
	return (error as { name?: unknown } | null)?.name === 'AbortError';
}

/**
 * What a failed call says to the person: that the server never answered or
 * answered too late, or the server's own reason (an `ApiError`, or a
 * `StreamError`'s frame) as plain copy, or `fallback` when it gave none.
 * Nothing else ever shows its message. An answer the page could not parse
 * gets one fixed sentence and a warning in the console, since the server
 * sent it and the app is not at fault (an error would put Next's issue badge
 * up in dev). Any other error is a bug, logged as an error, that reads as
 * `fallback`.
 */
export function failureText(error: unknown, fallback = NO_REASON_TEXT): string {
	if (error instanceof NetworkError) return OFFLINE_TEXT;
	if (error instanceof TimeoutError) return TIMEOUT_TEXT;
	if (error instanceof ApiError || error instanceof StreamError) return plainError(error.message) || fallback;
	if (isAbort(error)) return fallback;

	if (error instanceof SyntaxError) {
		console.warn(error);

		return UNREADABLE_TEXT;
	}

	console.error(error);

	return fallback;
}

/**
 * Runs a call whose failure a dialog shows in place, such as a confirmed
 * delete: it rejects with the plain failure text and keeps the original
 * error as the cause, so no toast repeats it.
 */
export async function plainly<T>(action: () => Promise<T>): Promise<T> {
	try {
		return await action();
	} catch (error) {
		throw new Error(failureText(error), { cause: error });
	}
}

/** How long a read waits for the server by default. */
const READ_TIMEOUT_MS = 10_000;

/**
 * How long a write waits by default. A write cut off here may still land on
 * the server, so it is longer than a read's wait; past it, the caller shows
 * the save as failed instead of pending for good.
 */
const WRITE_TIMEOUT_MS = 20_000;

/** How long a call waits when the server has to ask an agent CLI or a forge first, which can take seconds on a cold start. */
export const SLOW_MS = 30_000;

/**
 * A request's options. `timeoutMs` is how long it waits for the whole answer:
 * a read (GET) waits {@link READ_TIMEOUT_MS} and a write
 * {@link WRITE_TIMEOUT_MS} unless told otherwise. `fresh` makes a read send
 * its own request even when an identical one was just made.
 */
export interface RequestOptions extends RequestInit {
	timeoutMs?: number;
	fresh?: boolean;
}

/** The error a failed `fetch` or body read stands for: offline for the `TypeError` fetch rejects with, a timeout for the timer's abort. A caller's own abort stays an abort. */
function fetchFailure(error: unknown): unknown {
	if (error instanceof TypeError) return new NetworkError(error.message, { cause: error });
	if ((error as { name?: unknown } | null)?.name === 'TimeoutError')
		return new TimeoutError(TIMEOUT_TEXT, { cause: error });

	return error;
}

/** `fetch`, with its failures turned into a `NetworkError` or a `TimeoutError` (see {@link fetchFailure}). */
async function send(path: string, init?: RequestInit): Promise<Response> {
	try {
		return await fetch(`${API_BASE}${path}`, init);
	} catch (error) {
		throw fetchFailure(error);
	}
}

/** A response's body; a body cut off by the timer or a dropped connection fails like the request would. */
async function bodyText(response: Response): Promise<string> {
	try {
		return await response.text();
	} catch (error) {
		throw fetchFailure(error);
	}
}

/** True for a GET, the only method that is shared while in flight. */
function isRead(init: RequestInit): boolean {
	return (init.method ?? 'GET').toUpperCase() === 'GET';
}

/** The options `fetch` gets: the caller's signal, joined by the timer when the request has a time limit. */
function timed({ timeoutMs, ...init }: RequestOptions): RequestInit {
	const limit = timeoutMs ?? (isRead(init) ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS);

	if (limit <= 0) return init;

	const timer = AbortSignal.timeout(limit);

	return { ...init, signal: init.signal ? AbortSignal.any([init.signal, timer]) : timer };
}

/** The error a non-2xx response stands for, read from its `{ error, action, usageLimit }` body. */
async function responseError(response: Response): Promise<ApiError> {
	const body = (await response.json().catch(() => null)) as ErrorBody | null;

	return new ApiError(
		body?.error ?? `${response.status} ${response.statusText}`,
		response.status,
		body?.action,
		body?.usageLimit,
		body?.kind
	);
}

/** Path segments are server ids; encode them so an id never changes the route. */
export function seg(value: string | number): string {
	return encodeURIComponent(String(value));
}

/**
 * Reads still in flight that an identical read may join, by path. Identical
 * reads made at once (two stores loading on one page, or StrictMode running
 * each effect twice in dev) share one request, and each caller parses its own
 * copy, so none can change another's. Only reads made in the same task share:
 * a read asked later, say after the stream reported a change, never gets an
 * answer the server gave before that change.
 */
const inflight = new Map<string, Promise<string>>();

/** One request's body text, or the `ApiError` its non-2xx answer stands for. */
async function load(path: string, init: RequestOptions): Promise<string> {
	const headers = init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers;
	const response = await send(path, timed({ ...init, headers }));

	if (!response.ok) throw await responseError(response);

	return bodyText(response);
}

/** A read joined to an identical one made in this task, or a new one that identical reads join until this task ends or it settles. */
function shared(path: string, init: RequestOptions): Promise<string> {
	const pending = inflight.get(path);

	if (pending) return pending;

	const text = load(path, init);

	const forget = () => {
		if (inflight.get(path) === text) inflight.delete(path);
	};

	inflight.set(path, text);
	setTimeout(forget, 0);
	text.then(forget, forget);

	return text;
}

/**
 * A JSON request. A 2xx with no body (204) resolves to `undefined`. A read
 * without its own signal joins an identical one made in the same task (see
 * {@link inflight}); any write first lets go of those, so a read made after a
 * write never gets an answer from before it.
 */
export async function request<T>(path: string, { fresh, ...init }: RequestOptions = {}): Promise<T> {
	const read = isRead(init);

	if (!read) inflight.clear();

	const text = await (read && !fresh && !init.signal ? shared(path, init) : load(path, init));

	return (text ? JSON.parse(text) : undefined) as T;
}

/** POST a JSON body. */
export function post<T>(path: string, body: unknown = {}, init?: RequestOptions): Promise<T> {
	return request<T>(path, { ...init, method: 'POST', body: JSON.stringify(body) });
}

/** PUT a JSON body. */
export function put<T>(path: string, body: unknown, init?: RequestOptions): Promise<T> {
	return request<T>(path, { ...init, method: 'PUT', body: JSON.stringify(body) });
}

/** DELETE, with no body. */
export function del<T>(path: string): Promise<T> {
	return request<T>(path, { method: 'DELETE' });
}

/**
 * How long a stream may go without a byte before it fails as a timeout. A
 * whole limit would cut a long answer short, so this one starts over with each
 * chunk. Before its first token the server may wait two minutes for a model
 * slot and give the model two more, then it sends its own error frame, so this
 * trips only when the connection itself stalled.
 */
const STREAM_IDLE_MS = 300_000;

/** A signal that aborts once `touch` has gone uncalled for `ms`, joined to the caller's own. */
function idleTimer(ms: number, signal?: AbortSignal) {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;

	const touch = () => {
		clearTimeout(timer);
		timer = setTimeout(() => controller.abort(), ms);
	};

	touch();

	return {
		signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
		touch,
		/** True once the stream went quiet for too long, as opposed to the caller aborting it. */
		expired: () => controller.signal.aborted,
		stop: () => clearTimeout(timer)
	};
}

/**
 * POST a JSON body to a route that answers with server-sent events, and hand
 * each `data:` payload to `onEvent` as parsed JSON. A trailing event without
 * its blank line is still delivered. Resolves when the stream ends; rejects
 * with a `TimeoutError` when no byte came for {@link STREAM_IDLE_MS}, so a
 * stalled stream never leaves its caller pending.
 */
export async function postStream(
	path: string,
	body: unknown,
	onEvent: (event: unknown) => void,
	signal?: AbortSignal
): Promise<void> {
	inflight.clear();

	const idle = idleTimer(STREAM_IDLE_MS, signal);

	try {
		const response = await send(path, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
			body: JSON.stringify(body),
			signal: idle.signal
		});

		if (!response.ok) throw await responseError(response);
		if (!response.body) return;

		await readEvents(response.body, onEvent, idle.touch);
	} catch (error) {
		throw idle.expired() ? new TimeoutError(TIMEOUT_TEXT, { cause: error }) : fetchFailure(error);
	} finally {
		idle.stop();
	}
}

/**
 * Splits an event stream on blank lines and parses each frame's `data:` lines
 * as one JSON value. `onChunk` hears every chunk that arrives, frame or not.
 */
async function readEvents(
	stream: ReadableStream<Uint8Array>,
	onEvent: (event: unknown) => void,
	onChunk: () => void
): Promise<void> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	for (;;) {
		const { value, done } = await reader.read();

		onChunk();

		buffer = (buffer + decoder.decode(value, { stream: !done })).replace(/\r\n/g, '\n');

		const frames = buffer.split('\n\n');

		buffer = done ? '' : (frames.pop() ?? '');

		for (const frame of frames) emitFrame(frame, onEvent);

		if (done) return;
	}
}

/** One SSE frame: joins its `data:` lines and parses them; comments and malformed JSON are skipped. */
function emitFrame(frame: string, onEvent: (event: unknown) => void): void {
	const data = frame
		.split('\n')
		.filter((line) => line.startsWith('data:'))
		.map((line) => line.slice(5).replace(/^ /, ''))
		.join('\n');

	if (!data) return;

	try {
		onEvent(JSON.parse(data));
	} catch {}
}
