/**
 * Sivir's segmented Tabs pill only re-measures on list or window resize.
 * Nudge it whenever a tab's size changes (label/badge updates, font load,
 * a hidden list becoming visible) or tabs are added or removed.
 */
export function keepPillAligned(list: HTMLElement): () => void {
	let frame = 0;
	const nudge = () => {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
	};
	const ro = new ResizeObserver(nudge);
	const observe = () => list.querySelectorAll('[role="tab"]').forEach((tab) => ro.observe(tab));
	observe();
	const mo = new MutationObserver(() => {
		observe();
		nudge();
	});
	mo.observe(list, { childList: true });
	return () => {
		ro.disconnect();
		mo.disconnect();
		cancelAnimationFrame(frame);
	};
}

type PillRect = { left: number; width: number };
/** Where each carrying group's pill last settled, keyed by the selected value. */
const settled = new Map<string, { value: string; rect: PillRect }>();
/** Lists currently on screen; survives attachment re-runs on value change. */
const onScreen = new WeakSet<HTMLElement>();

/**
 * Several Tabs instances can stand for one switch (each view mounts its own
 * header). When a list appears showing a different value than the last visible
 * one, slide its pill over from that tab so the selection reads as one pill
 * travelling, not a jump. Changes within a visible list use Sivir's own transition.
 * Call inside an attachment so reading `value` re-runs it on change.
 */
export function carryPill(list: HTMLElement, group: string, value: string): () => void {
	let frame = 0;
	const settle = () => {
		const tab = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
		if (list.getClientRects().length === 0 || !tab) {
			onScreen.delete(list);
			return;
		}
		const host = list.getBoundingClientRect();
		const box = tab.getBoundingClientRect();
		const rect = { left: box.left - host.left, width: box.width };
		const from = settled.get(group);
		const pill = list.querySelector<HTMLElement>(':scope > [aria-hidden="true"]');
		if (!onScreen.has(list) && pill && from && from.value !== value && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
			pill.style.transition = 'none';
			pill.animate(
				[{ left: `${from.rect.left}px`, width: `${from.rect.width}px` }, { left: `${rect.left}px`, width: `${rect.width}px` }],
				{ duration: 240, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
			).finished.catch(() => {}).finally(() => pill.style.removeProperty('transition'));
		}
		onScreen.add(list);
		settled.set(group, { value, rect });
	};
	// Two frames: Sivir re-measures its pill on the first after a resize.
	const schedule = () => {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(() => (frame = requestAnimationFrame(settle)));
	};
	const ro = new ResizeObserver(schedule);
	ro.observe(list);
	schedule();
	return () => {
		ro.disconnect();
		cancelAnimationFrame(frame);
	};
}
