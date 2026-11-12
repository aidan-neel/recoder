import { useState, useSyncExternalStore } from 'react';

import { storedStyleScript, wholeIn } from '../shell/boot-vars';

/**
 * The lists Settings remembers the length of, so the next load's skeleton
 * has as many rows as the list it stands for, each with the rows a first
 * visit draws before the list has ever loaded here: the agent CLIs, the
 * commands under those that need one (to install or sign in), the rows of
 * the Providers group (0 when it doesn't show), the providers connected
 * (with none, the group's Add provider sits in its empty row, not its head),
 * the tracked repositories, the Storage group of the review harness (1 or
 * 0), and the Models group (2 pickers, or 1 row when no model is offered
 * yet).
 *
 * Two first-visit lengths are exact: the server lists every agent CLI it can
 * run, installed or not, and always names its config file. The rest are a
 * guess at a setup in use: every CLI ready, so no command under any, two
 * providers connected, two repositories and both pickers. The queue's setup
 * check stores the real number of repositories, and first run loads every
 * other list, so a guess is drawn only in a browser that has done neither.
 * There, a list of another length grows or shrinks its group at the swap,
 * once, and moves the groups under it; every later visit draws the length
 * it stored.
 */
const FIRST_ROWS = { agents: 3, cliCommands: 0, providers: 2, connected: 2, repos: 2, storage: 1, models: 2 } as const;

export type CountKey = keyof typeof FIRST_ROWS;

const COUNT_KEYS = Object.keys(FIRST_ROWS) as CountKey[];

type Counts = Partial<Record<CountKey, number>>;

const STORAGE_KEY = 'recoder.app.settings-counts.v1';

/** A skeleton never stands for more rows than this, whatever was stored. */
export const MAX_ROWS = 12;

/** The counts read from storage once, then kept here; null until the first read. */
let counts: Counts | null = null;

/** A stored count, when it is a whole number of rows. */
function rows(value: unknown): number | null {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? Math.min(value, MAX_ROWS) : null;
}

/** A stored JSON object, or null for anything else (nothing stored, not JSON, an array). */
function storedObject(text: string | null): Record<string, unknown> | null {
	try {
		const value: unknown = JSON.parse(text ?? 'null');

		return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** Reads a key, as null when storage is blocked. */
function read(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

/** Keeps a value under a key. Storage that is full or blocked only loses the hint. */
function write(key: string, value: unknown): void {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {}
}

/** Stored counts, keeping only well-formed ones under known names; anything else reads as never stored. */
export function parseCounts(text: string | null): Counts {
	const entries = storedObject(text) ?? {};

	return Object.fromEntries(
		COUNT_KEYS.flatMap((key) => {
			const valid = rows(entries[key]);

			return valid === null ? [] : [[key, valid]];
		})
	);
}

function stored(): Counts {
	counts ??= parseCounts(read(STORAGE_KEY));

	return counts;
}

/**
 * Keeps a list's length for the next load. A length that changed makes the
 * kept heights of the groups it shapes wrong, so those go until each is
 * measured again; a list stored for the first time had no height measured
 * with it. Other groups keep theirs.
 */
export function rememberCount(key: CountKey, count: number): void {
	const now = stored();
	const next = rows(count);

	if (next === null || now[key] === next) return;
	if (now[key] !== undefined) forgetHeights(SHAPED_BY[key]);

	counts = { ...now, [key]: next };
	write(STORAGE_KEY, counts);
}

/** Nothing to subscribe to: a skeleton keeps the shape it started with, and the content that lands replaces it. */
function subscribe(): () => void {
	return () => {};
}

/**
 * A value read from storage once the page has hydrated, held from the first
 * render that reads it, so a skeleton waiting on another group keeps its
 * shape while its own list lands and is remembered. Null in a server render
 * and the render that hydrates it, which can't read storage: a skeleton then
 * takes its shape from the CSS variables the scripts below set.
 */
function useFirstRead<T>(get: () => T): T | null {
	const live = useSyncExternalStore(subscribe, get, () => null);
	const [kept, setKept] = useState(live);

	if (kept === null && live !== null) setKept(live);

	return kept === null ? live : kept;
}

/** True in a server render and the render that hydrates it, which can't read storage. */
export function useBeforeStorage(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => false,
		() => true
	);
}

/**
 * How many rows a list had when it last loaded here, or its first-visit
 * length before it ever has ({@link FIRST_ROWS}). Null before storage can be
 * read ({@link useFirstRead}).
 */
export function useRowCount(key: CountKey): number | null {
	return useFirstRead(() => stored()[key] ?? FIRST_ROWS[key]);
}

/** The CSS variables {@link countScript} sets on `<html>` for a list, and the row count to read before it has. */
export function countVars(key: CountKey): { rows: string; ifRows: string; ifEmpty: string; fallback: number } {
	return {
		rows: `--settings-rows-${key}`,
		ifRows: `--settings-if-rows-${key}`,
		ifEmpty: `--settings-if-empty-${key}`,
		fallback: FIRST_ROWS[key]
	};
}

/**
 * A script for the server's HTML, placed before a skeleton, that runs before
 * first paint: it copies the list's remembered length onto `<html>` as CSS
 * variables, so the server's skeleton already has as many rows as the page
 * will. For an empty list it also sets the switches that hide what needs
 * rows (`none`) and show the empty state (`block`). A list never stored
 * keeps its first-visit length, which the variables default to. It mirrors
 * {@link parseCounts}.
 */
export function countScript(key: CountKey): string {
	const vars = countVars(key);
	const kept = `v[${JSON.stringify(key)}]`;

	return storedStyleScript(
		STORAGE_KEY,
		`v&&${wholeIn(kept, 0)}`,
		`var n=Math.min(${kept},${MAX_ROWS});s.setProperty('${vars.rows}',String(n));if(n===0){s.setProperty('${vars.ifRows}','none');s.setProperty('${vars.ifEmpty}','block');}`
	);
}

/**
 * The groups Settings draws, each named in its styles (`data-group`), whose
 * height it keeps for the next load's skeleton.
 */
const GROUP_KEYS = [
	'agentClis',
	'providers',
	'models',
	'forges',
	'repos',
	'reviewers',
	'limits',
	'storage',
	'globalGuidelines',
	'repoGuidelines',
	'display'
] as const;

export type GroupKey = (typeof GROUP_KEYS)[number];

/**
 * The groups whose height each list's length shapes. How many providers are
 * connected only decides whether Add provider sits in the Providers head,
 * which is as tall without it.
 */
const SHAPED_BY: Record<CountKey, readonly GroupKey[]> = {
	agents: ['agentClis'],
	cliCommands: ['agentClis'],
	providers: ['providers'],
	connected: [],
	repos: ['repos', 'repoGuidelines'],
	storage: ['storage'],
	models: ['models']
};

/** A group's height in px when it last loaded at a window width, since rows wrap with the width. */
interface KeptHeight {
	width: number;
	height: number;
}

/** Each group's heights, at the last few window widths it loaded at, the latest first. */
type Heights = Partial<Record<GroupKey, KeptHeight[]>>;

const HEIGHTS_KEY = 'recoder.app.settings-heights.v1';

/** How many window widths a group keeps a height for, so a window used at two sizes has both. */
const MAX_WIDTHS = 4;

/** A group taller than this is not kept: no list of {@link MAX_ROWS} rows is, so it holds something open. */
const MAX_HEIGHT = 2000;

/**
 * The window widths at which the settings layout changes: the phone rows,
 * the nav stacking above the section, the column reaching its widest (688px
 * beside the 224px nav), and the root font's two steps (`base.css`). Rows
 * wrap alike at nearby widths between two of them, and from the column's
 * widest to the first font step they wrap the same at every width.
 */
const BAND_EDGES = [461, 721, 912, 1920, 2400];

/** The heights read from storage once, then kept here; null until the first read. */
let heights: Heights | null = null;

/** A stored height, when it is a size a group can have. */
function size(value: unknown): number | null {
	return typeof value === 'number' && value > 0 && value <= MAX_HEIGHT ? value : null;
}

/** A stored height entry, when its width is a window width and its height a size a group can have. */
function keptHeight(value: unknown): KeptHeight | null {
	const entry = value && typeof value === 'object' ? (value as Partial<Record<keyof KeptHeight, unknown>>) : {};
	const { width } = entry;
	const height = size(entry.height);

	return typeof width === 'number' && Number.isInteger(width) && width > 0 && height !== null
		? { width, height }
		: null;
}

/** Stored group heights, keeping well-formed entries under known names, the first few per group; anything else reads as never measured. */
export function parseHeights(text: string | null): Heights {
	const entries = storedObject(text) ?? {};

	return Object.fromEntries(
		GROUP_KEYS.flatMap((key) => {
			const list = entries[key];
			const kept = Array.isArray(list) ? list.flatMap((entry) => keptHeight(entry) ?? []).slice(0, MAX_WIDTHS) : [];

			return kept.length ? [[key, kept]] : [];
		})
	);
}

/** Which band of {@link BAND_EDGES} a window width falls in. */
function band(width: number): number {
	return BAND_EDGES.filter((edge) => width >= edge).length;
}

/**
 * The height a group had at this window width, else, unless `exact`, at the
 * width nearest it in the same band (the latest of two as near); undefined
 * when neither was kept, which leaves its height to its rows.
 */
export function keptHeightAt(kept: Heights, group: GroupKey, width: number, exact: boolean): number | undefined {
	let best: KeptHeight | undefined;

	for (const entry of kept[group] ?? []) {
		const near = entry.width === width || (!exact && band(entry.width) === band(width));

		if (near && (!best || Math.abs(entry.width - width) < Math.abs(best.width - width))) best = entry;
	}

	return best?.height;
}

function storedHeights(): Heights {
	heights ??= parseHeights(read(HEIGHTS_KEY));

	return heights;
}

/** Drops the kept heights of `groups`, whose rows changed. */
function forgetHeights(groups: readonly GroupKey[]): void {
	const now = storedHeights();

	if (!groups.some((group) => now[group])) return;

	heights = Object.fromEntries(Object.entries(now).filter(([group]) => !groups.includes(group as GroupKey)));
	write(HEIGHTS_KEY, heights);
}

/** Keeps a loaded group's height at this window width for the next load's skeleton, the latest first. */
export function rememberHeight(group: GroupKey, height: number): void {
	const now = storedHeights();
	const next = size(Math.round(height * 100) / 100);
	const width = window.innerWidth;
	const list = now[group] ?? [];

	if (next === null || list.some((entry) => entry.width === width && entry.height === next)) return;

	const others = list.filter((entry) => entry.width !== width);

	heights = { ...now, [group]: [{ width, height: next }, ...others].slice(0, MAX_WIDTHS) };
	write(HEIGHTS_KEY, heights);
}

/**
 * How tall a group was when it last loaded, in px, at this window width or,
 * unless `exact`, the nearest kept in its band ({@link keptHeightAt});
 * undefined when none was. Null before storage can be read
 * ({@link useFirstRead}).
 */
export function useGroupHeight(group: GroupKey, exact: boolean): number | undefined | null {
	return useFirstRead(() => keptHeightAt(storedHeights(), group, window.innerWidth, exact));
}

/** The CSS variable {@link heightScript} sets on `<html>` for a group with a kept height. */
export function heightVar(group: GroupKey): string {
	return `--settings-height-${group}`;
}

/**
 * A script for the server's HTML, placed before a skeleton, that runs before
 * first paint: for each group with a kept height for this window width
 * ({@link keptHeightAt}, `exact` per group), it sets {@link heightVar} on
 * `<html>`, so the server's skeleton is already as tall as the page will be.
 * It mirrors {@link parseHeights} and {@link keptHeightAt}.
 */
export function heightScript(groups: readonly (readonly [GroupKey, boolean])[]): string {
	const each = groups.map(([group, exact]) => `f(${JSON.stringify(group)},'${heightVar(group)}',${exact});`).join('');

	return storedStyleScript(
		HEIGHTS_KEY,
		'v&&typeof v==="object"',
		`var E=${JSON.stringify(BAND_EDGES)},W=innerWidth;function b(w){var n=0;for(var i=0;i<E.length;i++)if(w>=E[i])n++;return n;}` +
			`function f(g,n,x){var l=v[g],k=0,h,d;if(!Array.isArray(l))return;for(var i=0;i<l.length&&k<${MAX_WIDTHS};i++){var e=l[i],w=e&&e.width,t=e&&e.height;` +
			`if(typeof w!=='number'||w%1!==0||w<=0||typeof t!=='number'||!(t>0&&t<=${MAX_HEIGHT}))continue;k++;` +
			`if((w===W||(!x&&b(w)===b(W)))&&(h===undefined||Math.abs(w-W)<d)){h=t;d=Math.abs(w-W);}}if(h!==undefined)s.setProperty(n,h+'px');}${each}`
	);
}
