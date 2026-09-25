<script lang="ts">
	import { Markdown } from '@sivir-ui/svelte/components/markdown';

	/**
	 * Sivir Markdown fed at a steady pace instead of in network-sized jumps.
	 * The reveal speeds up with the backlog so it trails the model by ~1/3s at
	 * most, and keeps draining after the stream ends rather than snapping.
	 * Text that was already complete when mounted renders at once.
	 */
	let { content, streaming = false }: { content: string; streaming?: boolean } = $props();

	const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
	// svelte-ignore state_referenced_locally
	let shown = $state(streaming && !reduced ? '' : content);
	let frame: number | undefined;
	let last = 0;

	function tick(now: number) {
		const dt = last ? Math.min(64, now - last) : 16;
		last = now;
		const backlog = content.length - shown.length;
		if (backlog <= 0) { frame = undefined; last = 0; return; }
		// ~45 chars/s baseline, faster when behind; land on a word end when one is close.
		let step = Math.max(1, Math.round((dt / 1000) * Math.max(45, backlog * 3)));
		const space = content.indexOf(' ', shown.length + step);
		if (space > 0 && space - (shown.length + step) < 6) step = space - shown.length + 1;
		shown = content.slice(0, Math.min(content.length, shown.length + step));
		frame = requestAnimationFrame(tick);
	}

	$effect(() => {
		const target = content;
		if (reduced || !target.startsWith(shown)) { shown = target; return; }
		if (target.length > shown.length && frame === undefined) frame = requestAnimationFrame(tick);
	});
	$effect(() => () => { if (frame !== undefined) cancelAnimationFrame(frame); });
</script>

<Markdown content={shown} streaming={streaming || shown.length < content.length} />
