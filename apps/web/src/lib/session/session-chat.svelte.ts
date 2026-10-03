import { tick } from 'svelte';
import { threadsStore } from '$lib/findings/threads.svelte';
import type { ReviewCodeContext } from '@recoder/shared';
import { PanelWidth, rootFontPx, trackPointerDrag } from './panel-width.svelte';

/** Dragging the drawer narrower than this (rem) collapses it; dragging back out reopens it. */
const CHAT_COLLAPSE = 12;

/** Pointer travel (px) before a press on the drawer edge counts as a drag rather than a click. */
const DRAG_THRESHOLD = 3;

/**
 * The "Ask reviewer" drawer beside the diff: open state, composer draft, attached code and its resizable width.
 * A finding thread takes the drawer's place while it is open.
 */
export class SessionChat {
	open = $state(false);
	draft = $state('');
	codeContext = $state<ReviewCodeContext | null>(null);

	/** Bumped on every open so the composer takes focus. */
	focusKey = $state(0);

	readonly width = new PanelWidth('recoder.chatWidth', 20, 45, 26.25);
	readonly shown = $derived(this.open && !threadsStore.openId);

	/** Where focus goes back to when the drawer closes. */
	#returnFocus: HTMLElement | null = null;

	/** Clears the drawer for a newly opened session. */
	reset(open: boolean): void {
		this.open = open;
		this.draft = '';
		this.codeContext = null;
	}

	/** Opens the drawer, optionally with code attached from the diff. */
	show(context?: ReviewCodeContext): void {
		this.#returnFocus = context
			? document.getElementById('ask-review')
			: document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;

		threadsStore.close();
		if (context) this.codeContext = context;
		this.open = true;
		this.focusKey++;
	}

	/** Collapses the drawer and returns focus to whatever opened it. */
	async close(): Promise<void> {
		this.open = false;
		await tick();
		if (this.#returnFocus?.isConnected) this.#returnFocus.focus();
		else document.getElementById('ask-review')?.focus();
	}

	toggle(): void {
		if (this.shown) void this.close();
		else this.show();
	}

	/** Drags the drawer's left edge: past the collapse width it closes, back out it reopens. */
	startResize = (event: PointerEvent): void => {
		if (event.button !== 0) return;

		const startX = event.clientX;
		const start = this.shown ? this.width.value : 0;
		const rootPx = rootFontPx();
		let moved = false;

		trackPointerDrag(event, (e) => {
			const width = start + (startX - e.clientX) / rootPx;

			if (Math.abs(e.clientX - startX) > DRAG_THRESHOLD) moved = true;
			if (!moved) return;

			if (width < CHAT_COLLAPSE) {
				if (this.open) this.open = false;

				return;
			}

			if (!this.open) {
				threadsStore.close();
				this.open = true;
			}

			this.width.set(width);
		});
	};

	/** Keyboard resizing on the drawer edge; Enter or Space toggles it and Left Arrow opens it when collapsed. */
	resizeKey = (event: KeyboardEvent): void => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			this.toggle();

			return;
		}

		if (!this.shown) {
			if (event.key === 'ArrowLeft') {
				event.preventDefault();
				this.show();
			}

			return;
		}

		const { value, min, max } = this.width;
		const next = { ArrowLeft: value + 1, ArrowRight: value - 1, Home: max, End: min }[event.key];

		if (next === undefined) return;
		event.preventDefault();
		if (event.key === 'ArrowRight' && value <= min) this.open = false;
		else this.width.set(next);
	};

	/** Escape lets go of attached code first (from the composer or the diff), then collapses the drawer. */
	onWindowKeydown = (event: KeyboardEvent): void => {
		if (event.key !== 'Escape' || event.defaultPrevented) return;

		const active = document.activeElement;

		if (
			this.codeContext &&
			this.shown &&
			(active?.closest('#interactive-review, #diff-panel') || active === document.body)
		) {
			event.preventDefault();
			this.codeContext = null;

			return;
		}

		if (active?.closest('#interactive-review')) {
			event.preventDefault();
			void this.close();
		}
	};
}
