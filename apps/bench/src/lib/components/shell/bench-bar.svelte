<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Moon from '@lucide/svelte/icons/moon';
	import Sun from '@lucide/svelte/icons/sun';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Tabs from '@sivir-ui/svelte/components/tabs';
	import * as Tooltip from '@sivir-ui/svelte/components/tooltip';
	import { keepPillAligned } from '$web/shell/tab-pill';
	import { theme } from '$web/settings/theme.svelte';

	const sections = [
		{ href: '/', title: 'Overview' },
		{ href: '/active', title: 'Active' },
		{ href: '/reports', title: 'Reports' },
		{ href: '/compare', title: 'Compare' },
		{ href: '/new', title: 'New run' }
	];

	/** The section a path belongs to: its first segment. */
	const current = $derived(`/${page.url.pathname.split('/')[1] ?? ''}`);

	let dark = $state(true);

	$effect(() => {
		void theme.choice;
		dark = document.documentElement.classList.contains('dark');
	});

	function toggleTheme(): void {
		theme.set(dark ? 'light' : 'dark');
	}
</script>

<header class="top-bar flex h-[46px] shrink-0 items-center gap-1 bg-chrome pr-[10px] pl-2 select-none">
	<span class="bench-mark">Recoder <span>bench</span></span>
	<nav aria-label="Sections" class="flex min-w-0 flex-1 items-center">
		<Tabs.Root value={current} onValueChange={(href) => void goto(href)} variant="segmented" class="top-tabs min-w-0">
			<Tabs.List {...{ 'aria-label': 'Sections' }} {@attach keepPillAligned}>
				{#each sections as section (section.href)}
					<Tabs.Trigger value={section.href} {...{ 'aria-controls': 'app-canvas' }}>{section.title}</Tabs.Trigger>
				{/each}
			</Tabs.List>
		</Tabs.Root>
	</nav>
	<Tooltip.Root delay={600}>
		<Tooltip.Trigger class="flex shrink-0">
			<Button
				variant="ghost"
				size="icon"
				aria-label={dark ? 'Use light theme' : 'Use dark theme'}
				onclick={toggleTheme}
			>
				{#if dark}
					<Sun size={15} strokeWidth={1.75} aria-hidden="true" />
				{:else}
					<Moon size={15} strokeWidth={1.75} aria-hidden="true" />
				{/if}
			</Button>
		</Tooltip.Trigger>
		<Tooltip.Content>{dark ? 'Light theme' : 'Dark theme'}</Tooltip.Content>
	</Tooltip.Root>
</header>
