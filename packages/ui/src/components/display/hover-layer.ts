/** What the hover layer follows: the highlighted row and the last pointer position over the list. */
export interface HoverTrack {
	row: HTMLElement | null;
	x: number;
	y: number;
}

/** Rows that never take the highlight. */
const DISABLED = '[aria-disabled="true"], :disabled';

/**
 * Moves the layer onto the row that holds `target`, or hides it when there is
 * none. The layer snaps: only its opacity transitions, so it never travels
 * between rows. Offsets are measured against the container's padding box and
 * include its scroll, because the layer is positioned inside it.
 */
export function placeLayer(
	container: HTMLElement,
	layer: HTMLElement,
	track: HoverTrack,
	target: Element | null,
	selector: string
): void {
	const row = target?.closest<HTMLElement>(selector) ?? null;

	if (!row || !container.contains(row) || row.matches(DISABLED)) {
		track.row = null;
		layer.dataset.state = 'off';

		return;
	}

	const host = container.getBoundingClientRect();
	const rect = row.getBoundingClientRect();
	const x = rect.left - host.left - container.clientLeft + container.scrollLeft;
	const y = rect.top - host.top - container.clientTop + container.scrollTop;

	layer.style.transform = `translate(${x}px, ${y}px)`;
	layer.style.width = `${rect.width}px`;
	layer.style.height = `${rect.height}px`;
	track.row = row;
	layer.dataset.state = 'on';
}
