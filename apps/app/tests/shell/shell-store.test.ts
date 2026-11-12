import { afterEach, beforeEach, expect, jest, test } from 'bun:test';

import { forgetReview, rememberReview } from '../../src/lib/review/review-cache';
import { SAMPLE_REVIEW } from '../../src/lib/sample/sample-review';
/** Loaded up front, so the store's own import of it resolves within the promise turns a test lets run. */
import '../../src/lib/settings/settings-prepare';
import { useSettings } from '../../src/lib/settings/settings-store';
import { lateArrival, useShell } from '../../src/lib/shell/shell-store';
import { flush } from '../fixtures';

/** The addresses the router was asked to show, to swap in for the current entry, and to prefetch, in order. */
let pushed: string[];
let replaced: string[];
let prefetched: string[];

/** Review reads the server holds until the test releases them, by review id. */
let held: Map<string, () => void>;

/** Settings reads the server holds until the test releases them, by path. */
let heldSettings: Map<string, () => void>;

/** The review settings' read, which the harness section paints from. */
const HARNESS_READ = '/api/settings/models';

/** What the settings reads answer, in the shape each one reads. */
const SETTINGS_ANSWERS: Record<string, unknown> = {
	[HARNESS_READ]: { models: [], limits: {} },
	'/api/agent': { agents: [] },
	'/api/agent/providers': { providers: [] }
};

/**
 * The review server: a review's own read waits until released; its diff and
 * the repositories answer at once, and so do the settings reads, except the
 * harness section's while `holdSettings` is set.
 */
async function serve(input: string | URL): Promise<Response> {
	const { pathname } = new URL(String(input));
	const id = /\/api\/reviews\/([^/]+)$/.exec(pathname)?.[1];

	if (id) await new Promise<void>((release) => held.set(id, release));
	if (holdSettings && pathname === HARNESS_READ)
		await new Promise<void>((release) => heldSettings.set(pathname, release));

	return new Response(JSON.stringify(id ? { ...SAMPLE_REVIEW, id } : (SETTINGS_ANSWERS[pathname] ?? [])));
}

/** True while the harness section's read waits for the test. */
let holdSettings: boolean;

/** Keeps a copy of review `id` in memory, as a read ahead leaves it. */
function keep(id: string): void {
	rememberReview(
		{ review: { ...SAMPLE_REVIEW, id }, files: [], pull: null, repoName: null, checks: null, progress: null },
		'never'
	);
}

/** Lets what is due run, moves the clock on, and lets the waits that end run their callbacks. */
async function pass(ms: number): Promise<void> {
	await flush();
	jest.advanceTimersByTime(ms);
	await flush();
}

/** The page whose skeleton the shell draws in the canvas, if any. */
function late(): string | null {
	return lateArrival(useShell.getState());
}

beforeEach(() => {
	jest.useFakeTimers();
	pushed = [];
	replaced = [];
	prefetched = [];
	held = new Map();
	heldSettings = new Map();
	holdSettings = false;
	Object.assign(globalThis, { fetch: serve });
	useShell.setState({ pathname: '/', arriving: null, opening: null });
	useSettings.setState({ status: 'idle', settings: null, catalogStatus: 'idle', models: null, agentsStatus: 'idle' });

	useShell.getState().setNavigate({
		push: (href) => pushed.push(href),
		replace: (href) => replaced.push(href),
		prefetch: (href) => prefetched.push(href)
	});
});

afterEach(async () => {
	for (const release of [...held.values(), ...heldSettings.values()]) release();

	await pass(1000);
	useShell.getState().setRoute('/');
	jest.useRealTimers();

	for (const id of ['rv-1', 'rv-2', 'rv-3', 'rv-4', 'rv-5']) forgetReview(id);
});

test('a review kept in memory goes to the router at once', () => {
	keep('rv-1');
	useShell.getState().navigate('/review/rv-1');

	expect(pushed).toEqual(['/review/rv-1']);
});

test('a review not read yet keeps the page on screen until its read lands, its page prefetched meanwhile', async () => {
	useShell.getState().navigate('/review/rv-2');
	await pass(100);

	expect(prefetched).toEqual(['/review/rv-2']);
	expect(pushed).toEqual([]);

	held.get('rv-2')?.();
	await flush();

	expect(pushed).toEqual(['/review/rv-2']);
});

test('a read slower than its limit lets the page go, so the review’s own skeleton takes over', async () => {
	useShell.getState().navigate('/review/rv-3');
	await pass(179);

	expect(pushed).toEqual([]);

	await pass(1);

	expect(pushed).toEqual(['/review/rv-3']);
});

test('a later navigation drops a wait still running', async () => {
	useShell.getState().navigate('/review/rv-4');
	useShell.getState().navigate('/settings/agent');
	await pass(200);

	expect(pushed).toEqual(['/settings/agent']);
});

test('Back during a wait drops it, so the review never opens over the page Back went to', async () => {
	useShell.getState().navigate('/review/rv-4');
	useShell.getState().follow('/');
	await pass(200);

	expect(pushed).toEqual([]);
	expect(late()).toBeNull();
});

test('a page the router has not shown after the wait gets its skeleton, until the router shows a page', async () => {
	useShell.getState().navigate('/settings/agent');
	await pass(179);

	expect(late()).toBeNull();

	await pass(1);

	expect(late()).toBe('/settings/agent');

	useShell.getState().setRoute('/settings/agent');

	expect(late()).toBeNull();
});

test('a navigation while a page’s skeleton shows turns it into the new page’s at once', async () => {
	keep('rv-1');
	useShell.getState().navigate('/settings/agent');
	await pass(180);
	useShell.getState().navigate('/review/rv-1');

	expect(late()).toBe('/review/rv-1');
});

test('going to the page on screen drops the page arriving, so the page shows again', async () => {
	useShell.getState().navigate('/settings/agent');
	await pass(180);
	useShell.getState().navigate('/');

	expect(useShell.getState().arriving).toBeNull();
});

test('a page the router shows from an earlier navigation leaves a later review open waiting, so the review still opens', async () => {
	useShell.getState().follow('/settings/agent');
	useShell.getState().setRoute('/settings/agent');
	useShell.getState().navigate('/review/rv-5');
	useShell.getState().setRoute('/');
	held.get('rv-5')?.();
	await flush();

	expect(pushed).toEqual(['/review/rv-5']);
});

test('a review opened while the router is still getting another page goes at once, so that page never lands in between', () => {
	useShell.getState().follow('/settings/agent');
	useShell.getState().navigate('/review/rv-5');

	expect(pushed).toEqual(['/review/rv-5']);
});

test('a settings page keeps the page on screen until its section’s read lands, its page prefetched meanwhile', async () => {
	holdSettings = true;
	useShell.getState().navigate('/settings/harness');
	await pass(100);

	expect(prefetched).toEqual(['/settings/harness']);
	expect(pushed).toEqual([]);

	heldSettings.get(HARNESS_READ)?.();
	await flush();

	expect(pushed).toEqual(['/settings/harness']);
});

test('a settings read slower than the wait lets the page go, so the section’s own skeleton takes over', async () => {
	holdSettings = true;
	useShell.getState().navigate('/settings/harness');
	await pass(179);

	expect(pushed).toEqual([]);

	await pass(1);

	expect(pushed).toEqual(['/settings/harness']);
});

test('a review chosen while settings still reads drops that wait, so settings never shows in between', async () => {
	holdSettings = true;
	keep('rv-1');
	useShell.getState().navigate('/settings/harness');
	await pass(100);
	useShell.getState().navigate('/review/rv-1');
	heldSettings.get(HARNESS_READ)?.();
	await pass(200);

	expect(pushed).toEqual(['/review/rv-1']);
});

test('from one settings page to another the section swaps in place once its read lands, with no router push', async () => {
	const swapped: string[] = [];

	Object.assign(globalThis, {
		window: { history: { pushState: (_: unknown, __: string, href: string) => swapped.push(href) } }
	});

	holdSettings = true;
	useShell.setState({ pathname: '/settings/agent' });
	useShell.getState().navigate('/settings/harness');
	await pass(100);

	expect(swapped).toEqual([]);

	heldSettings.get(HARNESS_READ)?.();
	await flush();
	Reflect.deleteProperty(globalThis, 'window');

	expect(swapped).toEqual(['/settings/harness']);
	expect(pushed).toEqual([]);
	expect(prefetched).toEqual([]);
});

test('a link back to the page on screen sends the router back to it, query kept, while it still gets another page', async () => {
	Object.assign(globalThis, { window: { location: { pathname: '/', search: '?q=api' } } });
	useShell.getState().navigate('/review/rv-3');
	await pass(200);
	useShell.getState().follow('/');
	Reflect.deleteProperty(globalThis, 'window');

	expect(pushed).toEqual(['/review/rv-3']);
	expect(replaced).toEqual(['/?q=api']);
	expect(late()).toBeNull();
});

test('a page the router shows instead of the one it was sent to (a redirect) ends the wait, so no skeleton stays', async () => {
	useShell.getState().navigate('/settings/agent');
	await pass(200);
	useShell.getState().setRoute('/settings/connections');

	expect(late()).toBeNull();
});

test('a swap between reviews that waits past its limit shows the new review’s skeleton until the swap lands', async () => {
	const swapped: string[] = [];

	useShell.setState({ pathname: '/review/rv-1' });
	useShell.getState().openReview('rv-4', () => swapped.push('rv-4'));
	await pass(179);

	expect(swapped).toEqual([]);

	await pass(1);

	expect(late()).toBe('/review/rv-4');
	expect(swapped).toEqual(['rv-4']);

	useShell.getState().setRoute('/review/rv-4');

	expect(late()).toBeNull();
});
