import { type FileDiff, type ProgressMessage, type Review } from '@recoder/shared';
import { langForPath, preloadHighlighter } from '@recoder/ui';

import { forgetReview } from '../../src/lib/review/review-cache';
import { useReview } from '../../src/lib/review/review-store';
import { SAMPLE_DIFFS } from '../../src/lib/sample/sample-diff';
import { SAMPLE_REVIEW } from '../../src/lib/sample/sample-review';
import { flush, memoryStorage } from '../fixtures';
import { FakeEventSource, sources } from './fake-event-source';

/** The fake review server: what it answers, and every path asked of it. Each test changes it. */
export const server = {
	review: SAMPLE_REVIEW as Review,
	/** The diff; empty while the server has not computed it. */
	diffs: SAMPLE_DIFFS as FileDiff[],
	/** Set once the review is deleted on the server: reading it answers 404. */
	deleted: false,
	/** While set, a diff read waits for this promise before it answers. */
	heldDiff: null as Promise<void> | null,
	/** While set, answers a path in place of the server (a failure, a held answer); null passes it on. */
	answers: null as ((path: string) => Promise<Response> | null) | null,
	/** Every path asked for, in order. */
	fetched: [] as string[]
};

/** A stream that opens at once, as a healthy server's does. */
class OpeningEventSource extends FakeEventSource {
	constructor() {
		super();
		queueMicrotask(() => this.accept());
	}
}

/** A JSON answer. */
export function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

/** The server's answer to one GET. */
function answer(path: string): Response {
	server.fetched.push(path);

	if (path === `/api/reviews/${server.review.id}`) {
		return server.deleted ? json({ error: 'review not found' }, 404) : json(server.review);
	}

	if (path.endsWith('/files')) return json(server.diffs);
	if (path.endsWith('/checks')) return json({ ref: server.review.headSha, checks: [] });

	return json([]);
}

/** Answers a fetch: a test's own answer first, then a held diff, then the server. */
function respond(input: string | URL): Promise<Response> {
	const path = new URL(String(input)).pathname;
	const own = server.answers?.(path);

	if (own) {
		server.fetched.push(path);

		return own;
	}

	if (server.heldDiff && path.endsWith('/files')) return server.heldDiff.then(() => answer(path));

	return Promise.resolve(answer(path));
}

/**
 * Loads the highlighter and the sample diff's grammars once, as a page does,
 * so each first load's wait for them settles on promises alone, under fake
 * timers too. Pass it to `beforeAll`.
 */
export function loadGrammars(): Promise<void> {
	return preloadHighlighter(SAMPLE_DIFFS.map((file) => langForPath(file.path)));
}

let stop: () => void = () => {};

/** Opens review rv-1 (at the item a link names), leaving any page open before; `settle` waits for its reads. */
export async function open(item: string | null = null, settle = true): Promise<void> {
	stop();
	stop = useReview.getState().load('rv-1', item);

	if (settle) await flush();
}

/** Leaves the page, which keeps a copy of the review. */
export function close(): void {
	stop();
	stop = () => {};
}

/** Leaves the page and forgets the copy it kept, so the next load is a first visit. */
export function leave(): void {
	close();
	forgetReview('rv-1');
}

/** Starts the server with a running review rv-1 and opens its page. Pass it to `beforeEach`. */
export async function serve(): Promise<void> {
	server.review = { ...SAMPLE_REVIEW, id: 'rv-1', status: 'running', summary: null };
	server.diffs = SAMPLE_DIFFS;
	server.deleted = false;
	server.heldDiff = null;
	server.answers = null;
	server.fetched.length = 0;

	Object.assign(globalThis, {
		EventSource: OpeningEventSource,
		fetch: respond,
		localStorage: memoryStorage(),
		document: {
			visibilityState: 'visible',
			addEventListener: () => {},
			removeEventListener: () => {},
			/** The app has mounted (`data-mounted`), so the page opens over another, as after a click; a test of a full page load sets it false. */
			documentElement: { hasAttribute: () => true }
		}
	});

	await open();
}

/** Leaves the page and puts the globals back. Pass it to `afterEach`. */
export function unserve(): void {
	leave();
	sources.length = 0;
	Reflect.deleteProperty(globalThis, 'localStorage');
	Reflect.deleteProperty(globalThis, 'document');
	Reflect.deleteProperty(globalThis, 'window');
}

/** Sends one event down the live stream. */
export function emit(message: ProgressMessage): void {
	sources.at(-1)?.onmessage?.({ data: JSON.stringify(message) });
}

/** How many times the store read the diff. */
export function diffReads(): number {
	return server.fetched.filter((path) => path.endsWith('/files')).length;
}

/** Tells the store the server finished computing the diff. */
export function diffDone(): void {
	emit({ type: 'task', data: { task: { id: 'diff', status: 'done' } } } as ProgressMessage);
}

/** A promise held until its release is called, for an answer a test lets land when it chooses. */
export function held(): { wait: Promise<void>; release: () => void } {
	let release = () => {};
	const wait = new Promise<void>((resolve) => (release = resolve));

	return { wait, release };
}
