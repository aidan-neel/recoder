import type { AskMessage, AskThread, ReviewThreads } from './ask-store';

/** One session-storage entry per review: its threads by item key. */
const PREFIX = 'recoder-ask:';

/** What a thread says when the page reloaded before its reply said anything. */
const RELOADED = 'The reply stopped when the page reloaded.';

function storage(): Storage | null {
	try {
		return typeof sessionStorage === 'undefined' ? null : sessionStorage;
	} catch {
		return null;
	}
}

function isMessage(value: unknown): value is AskMessage {
	const message = value as AskMessage | null;

	return (
		typeof message?.id === 'string' &&
		(message.role === 'user' || message.role === 'assistant') &&
		typeof message.text === 'string'
	);
}

/**
 * A thread as saved. A reply that was still streaming when the page went away
 * keeps its words as stopped; one that had said nothing yet reads as failed,
 * and the thread offers to ask again.
 */
function settle(raw: unknown): AskThread | null {
	const thread = raw as Partial<AskThread> | null;

	if (!Array.isArray(thread?.messages)) return null;

	const messages = thread.messages.filter(isMessage);
	const last = messages.at(-1);

	if (last?.state !== 'streaming') return { messages };

	const settled: AskMessage = last.text.trim()
		? { ...last, state: 'stopped' }
		: { ...last, state: 'failed', failure: { message: RELOADED } };

	return { messages: [...messages.slice(0, -1), settled] };
}

function parse(json: string | null): ReviewThreads | null {
	try {
		const raw = JSON.parse(json ?? 'null') as Record<string, unknown> | null;

		if (!raw || typeof raw !== 'object') return null;

		const threads: ReviewThreads = {};

		for (const [key, value] of Object.entries(raw)) {
			const thread = settle(value);

			if (thread) threads[key] = thread;
		}

		return threads;
	} catch {
		return null;
	}
}

/** Every review's threads saved in this tab. Threads last for the tab's session, like the conversation they hold. */
export function readThreads(): Record<string, ReviewThreads> {
	const store = storage();
	const all: Record<string, ReviewThreads> = {};

	if (!store) return all;

	for (let index = 0; index < store.length; index++) {
		const key = store.key(index);
		const threads = key?.startsWith(PREFIX) ? parse(store.getItem(key)) : null;

		if (key && threads) all[key.slice(PREFIX.length)] = threads;
	}

	return all;
}

/** Saves one review's threads. A full or blocked storage only costs the threads on reload. */
export function writeThreads(reviewId: string, threads: ReviewThreads): void {
	try {
		storage()?.setItem(`${PREFIX}${reviewId}`, JSON.stringify(threads));
	} catch {}
}
