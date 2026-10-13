<script lang="ts">
	import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
	import Inbox from '@lucide/svelte/icons/inbox';
	import LoaderCircle from '@lucide/svelte/icons/loader';
	import Search from '@lucide/svelte/icons/search';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as ContextMenu from '@sivir-ui/svelte/components/context-menu';
	import * as Tabs from '@sivir-ui/svelte/components/tabs';
	import Keycap from '../ui/keycap.svelte';
	import { shell, type ReviewTab } from '$lib/shell/shell.svelte';
	import { keepPillAligned } from '$web/shell/tab-pill';

	const QUEUE = 'queue';

	const sample = $derived(page.route.id === '/sample' || page.params.id === 'sample');
	const active = $derived(page.route.id === '/review/[id]' ? (page.params.id ?? QUEUE) : QUEUE);

	let menuTab = $state<ReviewTab | null>(null);

	function navigate(value: string): void {
		void goto(value === QUEUE ? (sample ? '/sample' : '/') : `/review/${value}`);
	}

	function close(ids: string[]): void {
		shell.closeTabs(ids);
		if (ids.includes(active)) navigate(QUEUE);
	}

	/** A review tab's attributes: what it controls, its title, and middle-click to close. */
	function tabProps(tab: ReviewTab): Record<string, unknown> {
		return {
			'aria-controls': 'app-canvas',
			'data-tab': tab.id,
			title: `${tab.title} · ${tab.repo} #${tab.pr}`,
			onauxclick: (event: MouseEvent) => event.button === 1 && (event.preventDefault(), close([tab.id]))
		};
	}

	/** The context menu acts on the tab it opened over, or on the bar as a whole. */
	function trackMenuTab(node: HTMLElement): () => void {
		const onMenu = (event: MouseEvent) => {
			const id = (event.target as HTMLElement).closest<HTMLElement>('[data-tab]')?.dataset.tab;

			menuTab = shell.tabs.find((tab) => tab.id === id) ?? null;
		};

		node.addEventListener('contextmenu', onMenu, true);

		return () => node.removeEventListener('contextmenu', onMenu, true);
	}
</script>

<header class="top-bar flex h-[46px] shrink-0 items-center gap-1 bg-chrome pr-[10px] pl-2 select-none">
	<nav aria-label="Reviews" class="relative flex min-w-0 flex-1 items-center">
		<ContextMenu.Root>
			<ContextMenu.Trigger class="flex min-w-0 flex-1 items-center" {@attach trackMenuTab}>
				<Tabs.Root value={active} onValueChange={navigate} variant="segmented" class="top-tabs min-w-0">
					<Tabs.List {...{ 'aria-label': 'Queue and open reviews' }} {@attach keepPillAligned}>
						<Tabs.Trigger value={QUEUE} {...{ 'aria-controls': 'app-canvas' }}>
							<Inbox size={14} strokeWidth={1.75} aria-hidden="true" />
							Queue
							{#if shell.waiting}<span
									class="font-mono text-[11.5px] text-fg-faint"
									aria-label="{shell.waiting} need you">{shell.waiting}</span
								>{/if}
						</Tabs.Trigger>
						{#if shell.tabs.length > 0}
							<span class="tab-sep mx-1.5 h-4 w-px shrink-0 bg-line-tab" aria-hidden="true"></span>
						{/if}
						{#each shell.tabs as tab (tab.id)}
							{@const Icon = tab.open === null ? LoaderCircle : GitPullRequest}
							<Tabs.Trigger value={tab.id} {...tabProps(tab)}>
								<Icon
									size={13}
									strokeWidth={1.75}
									class="shrink-0 {tab.open === null ? 'spin text-sev-medium' : 'text-ok'}"
									aria-hidden="true"
								/>
								{tab.repo.split('/').pop()}
								<span class="font-mono text-[11.5px] text-fg-faint">#{tab.pr}</span>
								{#if tab.open}<span class="tab-badge" data-tone={tab.high ? 'high' : undefined}>{tab.open}</span>{/if}
							</Tabs.Trigger>
						{/each}
					</Tabs.List>
				</Tabs.Root>
			</ContextMenu.Trigger>
			<ContextMenu.Content class="min-w-[13rem]">
				{#if menuTab}
					{@const tab = menuTab}
					{#if tab.id !== active}
						<ContextMenu.Item callback={() => navigate(tab.id)}>Open</ContextMenu.Item>
					{/if}
					<ContextMenu.Item callback={() => close([tab.id])}>Close tab</ContextMenu.Item>
					<ContextMenu.Item
						disabled={shell.tabs.length < 2}
						callback={() => close(shell.tabs.filter((item) => item.id !== tab.id).map((item) => item.id))}
					>
						Close other tabs
					</ContextMenu.Item>
				{:else}
					<ContextMenu.Item disabled={shell.tabs.length === 0} callback={() => close(shell.tabs.map((item) => item.id))}
						>Close all tabs</ContextMenu.Item
					>
				{/if}
			</ContextMenu.Content>
		</ContextMenu.Root>
	</nav>
	<Button
		variant="quiet"
		class="search-trigger"
		aria-label="Search or ask Recoder"
		aria-haspopup="dialog"
		onclick={() => (shell.paletteOpen = true)}
	>
		<Search size={14} aria-hidden="true" />
		<span class="min-w-0 flex-1 truncate text-left">Search or ask Recoder</span>
		<Keycap key="mod+k" />
	</Button>
</header>
