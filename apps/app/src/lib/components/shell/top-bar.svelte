<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Keyboard from '@lucide/svelte/icons/keyboard';
	import Search from '@lucide/svelte/icons/search';
	import * as Tooltip from '@sivir-ui/svelte/components/tooltip';
	import { page } from '$app/state';
	import { Button } from '@sivir-ui/svelte/components/button';
	import Keycap from '../ui/keycap.svelte';
	import ThemeToggle from './theme-toggle.svelte';
	import { shell } from '$lib/shell/shell.svelte';

	const onQueue = $derived(page.route.id === '/' || page.route.id === '/sample');
	const queueHref = $derived(
		page.url.searchParams.has('sample') || page.params.id === 'sample' || page.route.id === '/sample' ? '/sample' : '/'
	);
</script>

<header class="top-bar">
	<nav class="top-nav" aria-label="Primary">
		<a class="wordmark" href={queueHref}>Recoder</a>
		<span class="top-divider" aria-hidden="true"></span>
		<a class="top-link" href={queueHref} aria-current={onQueue ? 'page' : undefined}>
			Queue
			{#if shell.waiting}<span class="top-count tabular">{shell.waiting}</span>{/if}
		</a>
		{#if shell.crumb && !onQueue}
			<ChevronRight size={13} class="top-chevron" aria-hidden="true" />
			<span class="top-crumb">
				<span class="truncate">{shell.crumb.label}</span>
				{#if shell.crumb.detail}<span class="top-crumb-detail mono">{shell.crumb.detail}</span>{/if}
			</span>
		{/if}
	</nav>

	<div class="top-actions">
		<Button variant="ghost" class="top-search" onclick={() => (shell.paletteOpen = true)}>
			<Search size={14} aria-hidden="true" />
			<span>Search</span>
			<Keycap key="mod+k" />
		</Button>
		<Tooltip.Root placement="bottom">
			<Tooltip.Trigger>
				<Button
					variant="ghost"
					size="icon"
					aria-label="Keyboard shortcuts"
					onclick={() => (shell.shortcutsOpen = true)}
				>
					<Keyboard size={16} />
				</Button>
			</Tooltip.Trigger>
			<Tooltip.Content>Keyboard shortcuts</Tooltip.Content>
		</Tooltip.Root>
		<ThemeToggle />
	</div>
</header>
