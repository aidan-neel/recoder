<script lang="ts">
	import Inbox from '@lucide/svelte/icons/inbox';
	import Keyboard from '@lucide/svelte/icons/keyboard';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import SunMoon from '@lucide/svelte/icons/sun-moon';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import * as Command from '@sivir-ui/svelte/components/command';
	import Keycap from '../ui/keycap.svelte';
	import { shell, type PaletteItem } from '$lib/shell/shell.svelte';
	import { theme } from '$web/settings/theme.svelte';

	const APP: PaletteItem[] = [
		{ id: 'go-queue', group: 'Actions', label: 'Go to the queue', icon: Inbox, run: () => void goto('/') },
		{
			id: 'go-sample',
			group: 'Actions',
			label: 'Open the sample review',
			keywords: 'demo example tour',
			icon: Sparkles,
			run: () => void goto('/review/sample')
		},
		{
			id: 'shortcuts',
			group: 'Actions',
			label: 'Keyboard shortcuts',
			detail: '?',
			icon: Keyboard,
			run: () => (shell.shortcutsOpen = true)
		},
		{
			id: 'theme',
			group: 'Actions',
			label: 'Switch between light and dark',
			keywords: 'dark light appearance theme',
			icon: SunMoon,
			run: () => theme.set(document.documentElement.classList.contains('dark') ? 'light' : 'dark')
		}
	];

	const FOOTER: [string[], string][] = [
		[['ArrowUp', 'ArrowDown'], 'navigate'],
		[['Enter'], 'open'],
		[['Escape'], 'close']
	];

	const items = $derived([...shell.pageItems, ...APP]);
	const headings = $derived([...new Set(items.map((item) => item.group))]);
	const review = $derived(shell.tabs.find((tab) => tab.id === page.params.id));

	function run(item: PaletteItem): void {
		shell.paletteOpen = false;
		item.run();
	}
</script>

<Command.Root bind:open={shell.paletteOpen}>
	<Command.Content class="palette" label="Search Recoder">
		<div class="palette-search">
			<Command.Search placeholder={review ? 'Search this review and actions' : 'Search pull requests and actions'} />
			<span class="palette-scope" aria-live="polite">
				{#if review}in {review.repo.split('/').pop()} #{review.pr}{:else}the queue{/if}
			</span>
		</div>
		<Command.Results>
			{#each headings as heading (heading)}
				<Command.Group {heading}>
					<p class="palette-label" aria-hidden="true">{heading}</p>
					{#each items.filter((item) => item.group === heading) as item (item.id)}
						{@const Icon = item.icon}
						<Command.Item name={`${item.label} ${item.detail ?? ''} ${item.keywords ?? ''}`} callback={() => run(item)}>
							{#if Icon}<span class="palette-icon" style:color={item.tone}
									><Icon size={15} strokeWidth={1.75} aria-hidden="true" /></span
								>{/if}
							<span class="min-w-0 flex-1 truncate">{item.label}</span>
							{#if item.detail}<span class="palette-meta font-mono">{item.detail}</span>{/if}
						</Command.Item>
					{/each}
				</Command.Group>
			{/each}
		</Command.Results>
		<footer class="palette-footer">
			{#each FOOTER as [keys, label] (label)}
				<span
					>{#each keys as key (key)}<Keycap {key} />{/each}
					{label}</span
				>
			{/each}
		</footer>
	</Command.Content>
</Command.Root>
