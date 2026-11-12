import { reviewHref } from './routes';
import type { QueueScope, ReviewTab } from './shell-store';
import { fitPieces, fitTabs, type BarMeasure, type FitPieces, type SearchSize } from './tab-fit';

/** Where the open review tabs are saved. */
export const TABS_KEY = 'recoder.app.tabs.v2';

/** Where the bar keeps the fit it settles on at every window width (the search size and the More menu), for the next load's boot frame. */
const SEARCH_KEY = 'recoder.app.bar-search.v1';

/** Where the bar keeps the Queue count each queue last showed, with when that list loaded, for the next boot frame. */
const QUEUE_COUNT_KEY = 'recoder.app.queue-count.v1';

/**
 * Where the live queue's list is saved (`STORAGE_KEY` in queue-snapshot.ts).
 * Off the queue page the count comes back only with that list, so the boot
 * bar keeps no room for it once the list is gone.
 */
const QUEUE_LIST_KEY = 'recoder.app.queue.v1';

/**
 * How long a saved queue list holds: the queue paints one no older
 * (`queue-snapshot.ts`), and the boot bar keeps room for the count it brings
 * back as long. It is kept here, where the server's boot script reads it,
 * since `queue-snapshot.ts` holds a React hook that a server component's
 * module graph cannot take.
 */
export const SAVED_LIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The `<html>` attribute the boot script sets when the boot bar keeps room
 * for the Queue count, with `--boot-queue-digits` holding how many digits.
 * shell.css names it.
 */
const BOOT_QUEUE_ATTR = 'data-boot-queue';

/**
 * How many digits a queue page keeps room for when no count was ever saved:
 * a guess at the count the first load brings. The live queue's usually runs
 * to two digits; the sample's never passes nine.
 */
const FIRST_COUNT_DIGITS: Record<QueueScope, number> = { live: 2, sample: 1 };

/**
 * The `<html>` attribute the boot script sets when the bar will settle on a
 * smaller search than the full one: `narrow` or `icon`. The boot bar's
 * classes name it, since Tailwind needs them written out.
 */
const BOOT_SEARCH_ATTR = 'data-boot-search';

/** Saved tabs, keeping only well-formed entries. */
export function readTabs(): ReviewTab[] {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(TABS_KEY) ?? '[]');

		return Array.isArray(value)
			? value.filter((tab): tab is ReviewTab => typeof tab?.id === 'string' && typeof tab?.pr === 'number')
			: [];
	} catch {
		return [];
	}
}

export function saveTabs(tabs: ReviewTab[]): void {
	try {
		localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
	} catch {}
}

/** What the bar measured but the room: every piece's width, which the fit can lay out in any room. */
type Pieces = Omit<BarMeasure, 'room'>;

/**
 * From which width on each fit holds, in rising order: the search size and
 * the indexes of the tabs in the More menu. Below the first, the first.
 */
type Steps = [number, SearchSize, number[]][];

/** The id the saved steps give a review page's tab before it opens: no review id holds a slash. */
const OPENING = '/';

/** The saved steps for a review page whose tab is not saved: not a path, so no page's own steps take its key. */
const OPENING_STEPS = 'opening';

/**
 * Every room at which the fit can change the search's size: where all the
 * tabs fit beside the full or the shrunk search, and where the leading tabs
 * (with the active one beside them) stop fitting next to each search size and
 * the More menu. Each is taken at its whole pixel and the next, since the fit
 * compares sums that can round either way.
 */
function turns({ fixed, tabs, more, search }: FitPieces, active: string | null): number[] {
	const sums = tabs.reduce((list, tab) => [...list, list[list.length - 1] + tab.width], [0]);
	const lead = tabs.find((tab) => tab.id === active)?.width;
	const lengths = lead === undefined ? sums : [...sums, ...sums.map((sum) => sum + lead)];
	const beside = fixed + (tabs.length > 0 ? more : 0);
	const all = fixed + sums[sums.length - 1];
	const sizes = Object.values(search);

	const edges = [
		all + search.wide,
		all + search.narrow,
		...sizes.flatMap((size) => lengths.map((length) => beside + size + length))
	];

	return [0, ...edges.flatMap((edge) => [Math.ceil(edge), Math.ceil(edge) + 1])];
}

/** The fit in every room, as steps, for the given pieces and active tab. */
export function barSteps(pieces: FitPieces, active: string | null): Steps {
	const rooms = [...new Set(turns(pieces, active))].sort((a, b) => a - b);
	const steps: Steps = [];

	for (const room of rooms) {
		const { search, hidden } = fitTabs({ ...pieces, room, active });
		const more = hidden.map((id) => pieces.tabs.findIndex((tab) => tab.id === id));
		const last = steps[steps.length - 1];

		if (last?.[1] !== search || last[2].join() !== more.join()) steps.push([room, search, more]);
	}

	return steps;
}

/**
 * Keeps the fit the bar settles on at every window width, for the next load:
 * the boot script reads it before first paint, so the boot bar already shows
 * the tabs, the More menu and the search size the bar will. It holds for the
 * tabs and the root scale it was measured with; a review page whose tab
 * changes the answer (an active tab stays in the bar) gets its own steps,
 * and a review page whose tab is not open yet gets the steps with that tab's
 * room kept at the end (`fitPieces`). `chrome` is the window's width less
 * the room the bar measured.
 */
export function saveSearchSteps(pieces: Pieces, chrome: number, scale: number): void {
	const toWindow = (steps: Steps): Steps => steps.map(([room, size, more]) => [room + chrome, size, more]);
	const open = fitPieces(pieces, null);
	const base = toWindow(barSteps(open, null));

	const steps: Record<string, Steps> = {
		'': base,
		[OPENING_STEPS]: toWindow(barSteps(fitPieces(pieces, OPENING), OPENING))
	};

	for (const tab of pieces.tabs) {
		const own = toWindow(barSteps(open, tab.id));

		if (JSON.stringify(own) !== JSON.stringify(base)) steps[reviewHref(tab.id)] = own;
	}

	try {
		localStorage.setItem(
			SEARCH_KEY,
			JSON.stringify({ tabs: pieces.tabs.map((tab) => tab.id).join(' '), scale, steps, pieces, chrome })
		);
	} catch {}
}

function isNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

/** True for pieces saved by {@link saveSearchSteps} for exactly these tabs. */
function savedPieces(value: unknown, tabs: readonly ReviewTab[]): value is Pieces {
	if (!value || typeof value !== 'object') return false;

	const { queue, separator, more, widest, search, tabs: widths } = value as Partial<Record<keyof Pieces, unknown>>;
	const sizes = search && typeof search === 'object' ? (search as Partial<Record<SearchSize, unknown>>) : {};

	return (
		isNumber(queue) &&
		isNumber(separator) &&
		isNumber(more) &&
		isNumber(widest) &&
		isNumber(sizes.wide) &&
		isNumber(sizes.narrow) &&
		isNumber(sizes.icon) &&
		Array.isArray(widths) &&
		widths.length === tabs.length &&
		widths.every((tab: { id?: unknown; width?: unknown }, index) => tab?.id === tabs[index].id && isNumber(tab.width))
	);
}

/**
 * What the bar measured when it last saved its search sizes, laid out for
 * this window, when it measured these tabs; null otherwise. The bar starts
 * from it, so on a load like the last one its tabs are fitted in the frame it
 * mounts and its first measure changes nothing. It skips the root scale,
 * which would cost a style pass mid-render: at another scale the first
 * measure, still before the first paint, corrects the fit.
 */
export function readSavedMeasure(tabs: readonly ReviewTab[]): BarMeasure | null {
	try {
		const saved: { pieces?: unknown; chrome?: unknown } | null = JSON.parse(localStorage.getItem(SEARCH_KEY) ?? 'null');

		if (!saved || !isNumber(saved.chrome) || !savedPieces(saved.pieces, tabs)) return null;

		return { ...saved.pieces, room: window.innerWidth - saved.chrome };
	} catch {
		return null;
	}
}

/**
 * Keeps the Queue count a queue shows, with when its list loaded (null for
 * the sample, which never goes stale), so the next load's boot bar keeps the
 * count's room and the tab does not widen when the count lands. A refresh
 * that changes nothing writes nothing.
 */
export function saveQueueCount(scope: QueueScope, count: number, at: number | null): void {
	try {
		const raw = localStorage.getItem(QUEUE_COUNT_KEY) ?? '{}';
		const stored: unknown = JSON.parse(raw);
		const counts = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
		const next = JSON.stringify({ ...counts, [scope]: { count, at } });

		if (next !== raw) localStorage.setItem(QUEUE_COUNT_KEY, next);
	} catch {}
}

/**
 * The boot script's part that keeps room in the boot bar for the Queue
 * count of the queue this page's tab leads to (the sample's on the sample
 * pages): as many digits as it last showed, when its list comes back as the
 * app mounts (the live list is still saved and recent enough). A queue page
 * loads its count, so there it keeps that room however old the count, and
 * {@link FIRST_COUNT_DIGITS} when none was ever saved. Room for zero digits
 * is none: it then leaves {@link BOOT_QUEUE_ATTR} unset.
 */
export const BOOT_QUEUE_SCRIPT = `try{var q=JSON.parse(localStorage.getItem(${JSON.stringify(QUEUE_COUNT_KEY)})||'null'),sample=/^\\/(sample|review\\/sample\\/?)$/.test(location.pathname),queue=location.pathname==='/'||location.pathname==='/sample',c=q&&q[sample?'sample':'live'],digits=queue?(sample?${FIRST_COUNT_DIGITS.sample}:${FIRST_COUNT_DIGITS.live}):0;
if(c&&typeof c.count==='number')digits=c.count>0&&(queue||c.at===null||(Date.now()-c.at<=${SAVED_LIST_MAX_AGE_MS}&&localStorage.getItem(${JSON.stringify(QUEUE_LIST_KEY)})!==null))?String(Math.round(c.count)).length:0;
if(digits>0){document.documentElement.setAttribute(${JSON.stringify(BOOT_QUEUE_ATTR)},'');document.documentElement.style.setProperty('--boot-queue-digits',String(digits));}}catch(e){}`;

/** True when the boot bar kept room for the Queue count, so the bar keeps it until the count is known. */
export function bootKeptQueueRoom(): boolean {
	return document.documentElement.hasAttribute(BOOT_QUEUE_ATTR);
}

/**
 * Draws the saved tabs the fit shows into the boot bar, and the More menu
 * for the rest, before first paint. `open` is the saved tabs, `hidden` the
 * indexes in the More menu and `active` the page's review id; `opening` is
 * true when that page's tab is not saved. Then one past the last saved tab
 * is the page's own tab before it opens: the More menu counts and holds it
 * when the fit put it there, and otherwise it keeps its empty room in the
 * bar. The boot bar renders one of each piece
 * hidden (`data-boot-proto`), from the bar's own components; this copies
 * them into `data-boot-tabs`, which React leaves alone, and fills in each
 * tab's names, count and state, so the bar the app mounts lands on the same
 * pixels. The boot bar is not in the document yet when the head script
 * runs, so it waits for it: a mutation observer runs before the browser
 * paints what the parser added. It draws all or nothing, and stops watching
 * on any error.
 */
const DRAW_TABS = `function drawTabs(open,hidden,active,opening){
function draw(){
var box=document.querySelector('[data-boot-tabs]'),protos=document.querySelector('[data-boot-protos]');
if(!box||!protos)return false;
function make(name){return protos.querySelector('[data-boot-proto="'+name+'"]').firstElementChild.cloneNode(true);}
var list=document.createDocumentFragment();
list.appendChild(make('separator'));
open.forEach(function(t,i){
if(hidden.indexOf(i)!==-1)return;
var grow=make(t.open===null?'running':'done'),tab=grow.querySelector('[data-ui="top-tab"]'),link=tab.querySelector('[data-ui="top-tab-link"]');
function part(ui){return link.querySelector('[data-ui="'+ui+'"]');}
var repo=String(t.repo).split('/').pop(),title=String(t.title),count=part('tab-count');
part('tab-repo').textContent=repo;
part('tab-number').textContent='#'+t.pr;
if(title.trim()!==''&&title!=='#'+t.pr)part('tab-title').textContent=title;else part('tab-title').remove();
if(count&&t.open){count.firstChild.nodeValue=String(t.open);if(t.high)count.setAttribute('data-tone','high');}else if(count)count.remove();
tab.setAttribute('data-tab',t.id);
link.setAttribute('href','/review/'+encodeURIComponent(t.id));
link.setAttribute('data-tab-id',t.id);
link.setAttribute('title',title+' \\u00b7 '+t.repo+' #'+t.pr);
tab.querySelector('[data-slot="tab-close"]').setAttribute('aria-label','Close '+repo+' #'+t.pr);
if(t.id===active){tab.setAttribute('data-state','active');link.setAttribute('aria-current','page');tab.insertBefore(make('pill'),tab.firstChild);}
list.appendChild(grow);
});
if(opening&&hidden.indexOf(open.length)===-1)list.appendChild(make('room'));
if(hidden.length>0){
var more=make('more'),button=more.querySelector('[data-slot="tab-more"]');
button.querySelector('[data-ui="tab-count"]').textContent=String(hidden.length);
button.setAttribute('aria-label',hidden.length+' more tabs');
if(hidden.some(function(i){return i>=open.length||open[i].id===active;}))button.setAttribute('data-holds-active','');
list.appendChild(more);
}
box.appendChild(list);
return true;
}
if(draw())return;
var watch=new MutationObserver(function(){try{if(draw())watch.disconnect();}catch(e){watch.disconnect();}});
watch.observe(document,{childList:true,subtree:true});
addEventListener('DOMContentLoaded',function(){watch.disconnect();});
}`;

/**
 * The boot script's part that lays out the boot bar: when the saved fit was
 * measured with the tabs saved now, at this root scale, it sets
 * {@link BOOT_SEARCH_ATTR} to the search size it gives this window and page,
 * and draws the tabs it shows (`DRAW_TABS`). A review page whose tab is not
 * saved takes the steps that keep that tab's room ({@link OPENING_STEPS}),
 * as the bar does until the tab opens. Anything else leaves the Queue tab
 * beside the full search, as the bar starts.
 */
export const BOOT_SEARCH_SCRIPT = `try{${DRAW_TABS}
var bar=JSON.parse(localStorage.getItem(${JSON.stringify(SEARCH_KEY)})||'null'),open=JSON.parse(localStorage.getItem(${JSON.stringify(TABS_KEY)})||'[]');
if(bar&&bar.scale===parseFloat(getComputedStyle(document.documentElement).fontSize)/16&&bar.tabs===open.map(function(t){return t&&t.id;}).join(' ')){
var page=/^\\/review\\/([^/]+)\\/?$/.exec(location.pathname),id=page&&decodeURIComponent(page[1]),opening=!!id&&!open.some(function(t){return t.id===id;});
var steps=bar.steps[location.pathname]||(opening&&bar.steps[${JSON.stringify(OPENING_STEPS)}])||bar.steps[''],step=null;
for(var i=0;i<steps.length&&innerWidth>=steps[i][0];i++)step=steps[i];
if(step&&step[1]!=='wide')document.documentElement.setAttribute(${JSON.stringify(BOOT_SEARCH_ATTR)},step[1]);
if(step&&Array.isArray(step[2])&&(open.length>0||step[2].length>0))drawTabs(open,step[2],id,opening);}}catch(e){}`;
