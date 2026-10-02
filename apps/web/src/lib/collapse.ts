import { cubicOut } from 'svelte/easing';
import { slide, type TransitionConfig } from 'svelte/transition';

/**
 * Height + fade for blocks that appear or leave in place (findings shown or
 * hidden by a severity filter, dismissed). Use as `in:collapse out:collapse`:
 * Use as `in:collapse out:collapse`.
 */
export function collapse(node: Element, { duration = 240 }: { duration?: number } = {}, _options?: { direction?: 'in' | 'out' | 'both' }): TransitionConfig {
	const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
	const base = slide(node, { duration: reduce ? 0 : duration, easing: cubicOut });
	return { ...base, css: (t, u) => `${base.css?.(t, u) ?? ''};opacity:${t};` };
}
