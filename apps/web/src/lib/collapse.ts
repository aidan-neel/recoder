import { cubicOut } from 'svelte/easing';
import { slide, type TransitionConfig } from 'svelte/transition';

/**
 * Height + fade for blocks that appear or leave in place (findings shown or
 * hidden by a severity filter, dismissed). Use as `in:collapse out:collapse`:
 * an entering block (and any `.enter-rise` inside it) skips its entrance so the two don't stack.
 */
export function collapse(node: Element, { duration = 220 }: { duration?: number } = {}, options?: { direction?: 'in' | 'out' | 'both' }): TransitionConfig {
	const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
	if (options?.direction === 'in') {
		for (const el of [node, ...node.querySelectorAll('.enter-rise')]) if (el instanceof HTMLElement) el.style.animation = 'none';
	}
	const base = slide(node, { duration: reduce ? 0 : duration, easing: cubicOut });
	return { ...base, css: (t, u) => `${base.css?.(t, u) ?? ''};opacity:${t};` };
}
