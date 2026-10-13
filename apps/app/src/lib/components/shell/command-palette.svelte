<script lang="ts">
	import Inbox from '@lucide/svelte/icons/inbox';
	import SunMoon from '@lucide/svelte/icons/sun-moon';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import { goto } from '$app/navigation';
	import * as Command from '@sivir-ui/svelte/components/command';
	import Keycap from '../ui/keycap.svelte';
	import { theme } from '$web/settings/theme.svelte';
	import { shell, type PaletteItem } from '$lib/shell/shell.svelte';

	const APP: PaletteItem[] = [
		{ id: 'go-queue', group: 'Go to', label: 'Queue', icon: Inbox, run: () => void goto('/') },
		{
			id: 'go-sample',
			group: 'Go to',
			label: 'Sample review',
			keywords: 'demo example tour',
			icon: Sparkles,
			run: () => void goto('/review/sample')
		},
		{
			id: 'theme',
			group: 'Preferences',
			label: 'Switch theme',
			keywords: 'dark light appearance',
			icon: SunMoon,
			run: () => theme.set(theme.choice === 'dark' ? 'light' : 'dark')
		}
	];

	const items = $derived([...shell.pageItems, ...APP]);
	const headings = $derived([...new Set(items.map((item) => item.group))]);

	function run(item: PaletteItem): void {
		shell.paletteOpen = false;
		item.run();
	}
</script>

<Command.Root bind:open={shell.paletteOpen}>
	<Command.Content class="palette" label="Search Recoder">
		<Command.Search placeholder="Search decisions, files and actions" />
		<Command.Results>
			{#each headings as heading (heading)}
				<Command.Group {heading}>
					{#each items.filter((item) => item.group === heading) as item (item.id)}
						{@const Icon = item.icon}
						<Command.Item
							name={`${item.label} ${item.detail ?? ''} ${item.keywords ?? ''} ${heading}`}
							callback={() => run(item)}
						>
							{#if Icon}<span class="palette-icon" style:color={item.tone}><Icon size={15} aria-hidden="true" /></span
								>{/if}
							<span class="min-w-0 flex-1 truncate">{item.label}</span>
							{#if item.detail}<span class="palette-detail mono">{item.detail}</span>{/if}
						</Command.Item>
					{/each}
				</Command.Group>
			{/each}
		</Command.Results>
		<footer class="palette-footer">
			<span><Keycap key="ArrowUp" /><Keycap key="ArrowDown" /> move</span>
			<span><Keycap key="Enter" /> open</span>
			<span><Keycap key="Escape" /> close</span>
		</footer>
	</Command.Content>
</Command.Root>
