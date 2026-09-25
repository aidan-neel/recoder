<script lang="ts">
	import { page } from '$app/state';
	import House from '@lucide/svelte/icons/house';
	import { Button } from '@sivir-ui/svelte/components/button';
	import ProviderMark from '$web/components/provider-mark.svelte';
	import { hoverHighlight } from '$web/hover-highlight';
	import { docs } from '$lib/docs';

	const repo = 'https://github.com/aidan-neel/recoder';
	const links = [{ href: '/', title: 'Home', icon: House }, ...docs.map((doc) => ({ href: `/docs/${doc.slug}`, title: doc.title, icon: doc.icon }))];

	const current = $derived(page.url.pathname.replace(/\/$/, '') || '/');

	/* The active pill slides to the current link; hover uses the instant highlight. */
	let listEl = $state<HTMLElement>();
	let pill = $state<{ left: number; top: number; width: number; height: number } | null>(null);
	let pillReady = $state(false);

	function measure(): HTMLElement | null {
		const el = listEl?.querySelector<HTMLElement>('[aria-current="page"]') ?? null;
		pill = el ? { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight } : null;
		return el;
	}

	$effect(() => {
		void current;
		// On mobile the links scroll sideways; keep the current one in view.
		measure()?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		// Place the pill without travel on first paint, then let it slide.
		requestAnimationFrame(() => (pillReady = true));
	});

	// Re-measure when fonts load or the layout switches between the side column and the top row.
	$effect(() => {
		if (!listEl) return;
		const ro = new ResizeObserver(() => measure());
		ro.observe(listEl);
		for (const item of listEl.querySelectorAll('.site-nav-item')) ro.observe(item);
		return () => ro.disconnect();
	});
</script>

<nav class="site-nav" aria-label="Site">
	<div class="site-nav-list" bind:this={listEl} {@attach hoverHighlight({ items: '.site-nav-item', class: 'site-nav-hl' })}>
		{#if pill}
			<span
				class="site-nav-pill"
				data-ready={pillReady || undefined}
				aria-hidden="true"
				style:transform={`translate(${pill.left}px, ${pill.top}px)`}
				style:width={`${pill.width}px`}
				style:height={`${pill.height}px`}
			></span>
		{/if}
		{#each links as link, i (link.href)}
			{@const Icon = link.icon}
			<Button
				href={link.href}
				variant="ghost"
				class="site-nav-item enter-rise"
				style={`--i: ${i}`}
				aria-current={current === link.href ? 'page' : undefined}
			>
				<Icon size={16} strokeWidth={1.7} aria-hidden="true" />
				{link.title}
			</Button>
		{/each}
		<Button href={repo} variant="ghost" class="site-nav-item enter-rise" style={`--i: ${links.length}`}>
			<span class="flex" aria-hidden="true"><ProviderMark provider="github" size={16} /></span>
			GitHub
		</Button>
	</div>
</nav>

