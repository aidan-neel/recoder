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

/** True when the request never reached the server. */
export function isOffline(error: unknown): boolean {
	return error instanceof NetworkError;
}

/** The one sentence for a server that never answered. */
export const OFFLINE_TEXT = 'Can’t reach the review server.';

/**
 * What a failed call says to the person: that the server never answered, the
 * server's own reason as plain copy, or `fallback` when it gave none. An error
 * frame inside a stream is a plain `Error` that carries the server's words.
 */
export function failureText(error: unknown, fallback = 'Try again in a moment.'): string {
	if (error instanceof NetworkError) return OFFLINE_TEXT;

	return (error instanceof Error && plainError(error.message)) || fallback;
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

/**
 * `fetch`, with a failure to reach the server (the `TypeError` fetch rejects
 * with) turned into a `NetworkError`. An abort stays an abort.
 */
async function send(path: string, init?: RequestInit): Promise<Response> {
	try {
		return await fetch(`${API_BASE}${path}`, init);
	} catch (error) {
		if (error instanceof TypeError) throw new NetworkError(error.message, { cause: error });

		throw error;
	}
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

/** A JSON request. A 2xx with no body (204) resolves to `undefined`. */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const headers = init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers;
	const response = await send(path, { ...init, headers });

	if (!response.ok) throw await responseError(response);

	const text = await response.text();

	return (text ? JSON.parse(text) : undefined) as T;
}

/** POST a JSON body. */
export function post<T>(path: string, body: unknown = {}, init?: RequestInit): Promise<T> {
	return request<T>(path, { ...init, method: 'POST', body: JSON.stringify(body) });
}

/** PUT a JSON body. */
export function put<T>(path: string, body: unknown): Promise<T> {
	return request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
}

/** DELETE, with no body. */
export function del<T>(path: string): Promise<T> {
	return request<T>(path, { method: 'DELETE' });
}

/**
 * POST a JSON body to a route that answers with server-sent events, and hand
 * each `data:` payload to `onEvent` as parsed JSON. A trailing event without
 * its blank line is still delivered. Resolves when the stream ends.
 */
export async function postStream(
	path: string,
	body: unknown,
	onEvent: (event: unknown) => void,
	signal?: AbortSignal
): Promise<void> {
	const response = await send(path, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
		body: JSON.stringify(body),
		signal
	});

	if (!response.ok) throw await responseError(response);
	if (!response.body) return;

	await readEvents(response.body, onEvent);
}

/** Splits an event stream on blank lines and parses each frame's `data:` lines as one JSON value. */
async function readEvents(stream: ReadableStream<Uint8Array>, onEvent: (event: unknown) => void): Promise<void> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	for (;;) {
		const { value, done } = await reader.read();

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
