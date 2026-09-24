import type { Attachment } from 'svelte/attachments';

interface HoverHighlightOptions {
	/** Items that receive the highlight, matched from the hovered target. */
	items: string;
	/** Extra class for the highlight layer (radius, color). */
	class?: string;
}

/**
 * One highlight layer per list or tab group. It snaps to the hovered item with no
 * travel and fades in and out over 120ms (DESIGN.md `highlight`). The container
 * must be positioned; items sit above the layer via `isolation`.
 */
export function hoverHighlight(options: HoverHighlightOptions): Attachment<HTMLElement> {
	return (container) => {
		const layer = document.createElement('span');
		layer.setAttribute('aria-hidden', 'true');
		layer.className = `hover-highlight ${options.class ?? ''}`;
		container.prepend(layer);
		let current: HTMLElement | null = null;

		function place(item: HTMLElement): void {
			const host = container.getBoundingClientRect();
			const rect = item.getBoundingClientRect();
			layer.style.transform = `translate(${rect.left - host.left + container.scrollLeft}px, ${rect.top - host.top + container.scrollTop}px)`;
			layer.style.width = `${rect.width}px`;
			layer.style.height = `${rect.height}px`;
		}

		function over(event: Event): void {
			const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(options.items);
			if (!target || !container.contains(target) || target.matches('[aria-disabled="true"], :disabled')) {
				hide();
				return;
			}
			current = target;
			place(target);
			layer.dataset.on = 'true';
		}

		function hide(): void {
			current = null;
			delete layer.dataset.on;
		}

		const ro = new ResizeObserver(() => {
			if (current?.isConnected) place(current);
			else hide();
		});
		ro.observe(container);
		container.addEventListener('pointerover', over);
		container.addEventListener('pointerleave', hide);
		return () => {
			ro.disconnect();
			container.removeEventListener('pointerover', over);
			container.removeEventListener('pointerleave', hide);
			layer.remove();
		};
	};
}
