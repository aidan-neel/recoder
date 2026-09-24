<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount, tick } from 'svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
	import Inbox from '@lucide/svelte/icons/inbox';
	import LoaderCircle from '@lucide/svelte/icons/loader';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import * as Avatar from '@sivir-ui/svelte/components/avatar';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as ContextMenu from '@sivir-ui/svelte/components/context-menu';
	import * as DropdownMenu from '@sivir-ui/svelte/components/dropdown-menu';
	import { Progress } from '@sivir-ui/svelte/components/progress';
	import Shortcut from '@sivir-ui/svelte/components/shortcut';
	import * as Tabs from '@sivir-ui/svelte/components/tabs';
	import * as Tooltip from '@sivir-ui/svelte/components/tooltip';
	import { modelSettingsUi } from '$lib/model-settings.svelte';
	import { openPrs } from '$lib/open-prs.svelte';
	import { paletteContext } from '$lib/palette.svelte';
	import { recentSessions } from '$lib/recent-sessions.svelte';
	import { sessionState } from '$lib/session-state.svelte';
	import { closeSessionTab, sessionTab, type SessionTab } from '$lib/session-tabs';
	import { requestDeleteSession } from '$lib/delete-session.svelte';
	import { initials, shellState } from '$lib/shell-state.svelte';
	import { keepPillAligned } from '$lib/tab-pill';

	const HOME = 'home';

	onMount(() => {
		shellState.load();
		void openPrs.load();
		void recentSessions.load();
		return recentSessions.watchRunning();
	});

	const repoNames = $derived(new Map(recentSessions.repos.map((repo) => [repo.id, repo.name] as const)));
	const tabs = $derived<SessionTab[]>(
		sessionState.sessions.map((session) => {
			const review = recentSessions.reviews.find((item) => item.id === session.id);
			return sessionTab(
				session,
				review,
				review ? repoNames.get(review.repoId) : undefined,
				recentSessions.summaries[session.id]
			);
		})
	);

	const activeValue = $derived.by(() => {
		const match = /^\/session\/([^/]+)/.exec(page.url.pathname);
		return match ? match[1] : page.url.pathname === '/' ? HOME : '';
	});

	function navigate(value: string): void {
		if (value === activeValue) return;
		void goto(value === HOME ? '/' : `/session/${value}`);
	}

	async function newReview(): Promise<void> {
		await goto('/');
		await tick();
		document.getElementById('home-filter')?.focus();
	}

	/* ── Overflow: tabs that don't fit move into a menu; the active tab stays visible. ── */
	let regionWidth = $state(0);
	let measureEl = $state<HTMLElement>();
	let widths = $state<number[]>([]);
	let fixedWidth = $state(0);
	const OVERFLOW_BUTTON = 64;
	const PLUS_BUTTON = 34;

	/** Root font scale; large monitors raise it (app.css), and the button sizes above follow. */
	let scale = $state(1);

	$effect(() => {
		void tabs;
		void regionWidth;
		if (!measureEl) return;
		const el = measureEl;
		void tick().then(() => {
			const items = Array.from(el.children) as HTMLElement[];
			scale = parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1;
			fixedWidth = items[0]?.offsetWidth ?? 0;
			widths = items.slice(1).map((item) => item.offsetWidth);
		});
	});

	const visibleIds = $derived.by(() => {
		const all = tabs.map((tab) => tab.id);
		if (!regionWidth || widths.length !== all.length) return all;
		const fit = (budget: number): string[] => {
			const shown: string[] = [];
			let used = fixedWidth;
			for (let i = 0; i < all.length; i++) {
				used += widths[i];
				if (used > budget) break;
				shown.push(all[i]);
			}
			return shown;
		};
		const budget = regionWidth - PLUS_BUTTON * scale;
		let shown = fit(budget);
		if (shown.length < all.length) shown = fit(budget - OVERFLOW_BUTTON * scale);
		const active = all.indexOf(activeValue);
		if (active >= shown.length && shown.length > 0) {
			shown = [...shown.slice(0, -1), all[active]];
		}
		return shown;
	});
	const visibleTabs = $derived(tabs.filter((tab) => visibleIds.includes(tab.id)));
	const hiddenTabs = $derived(tabs.filter((tab) => !visibleIds.includes(tab.id)));

	/* ── Context menu: acts on the tab under the pointer, or the bar itself. ── */
	let menuTabId = $state<string | null>(null);
	const menuTab = $derived(tabs.find((tab) => tab.id === menuTabId) ?? null);
	const menuTabUrl = $derived(recentSessions.reviews.find((review) => review.id === menuTabId)?.prUrl ?? null);

	function trackMenuTab(node: HTMLElement): () => void {
		const onMenu = (event: MouseEvent) => {
			menuTabId = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tab]')?.dataset.tab ?? null;
		};
		node.addEventListener('contextmenu', onMenu, true);
		return () => node.removeEventListener('contextmenu', onMenu, true);
	}

	async function closeTabs(list: SessionTab[]): Promise<void> {
		for (const tab of list) await closeSessionTab(tab.id);
	}

	const toneColor: Record<SessionTab['tone'], string> = {
		draft: 'var(--text-muted)',
		running: 'var(--sev-medium)',
		passed: 'var(--success)',
		failed: 'var(--danger)',
		high: 'var(--success)'
	};
</script>

{#snippet tabBody(tab: SessionTab)}
	<span class="flex shrink-0 items-center" style:color={toneColor[tab.tone]}>
		{#if tab.tone === 'running'}
			<LoaderCircle size={12} strokeWidth={1.75} class="spin" aria-hidden="true" />
		{:else}
			<GitPullRequest size={13} strokeWidth={1.75} aria-hidden="true" />
		{/if}
	</span>
	<span class="whitespace-nowrap">{tab.repo}</span>
	{#if tab.pr}<span class="font-mono text-[11.5px] text-fg-faint">{tab.pr}</span>{/if}
	{#if tab.badge}<span class="tab-badge" data-tone={tab.tone}>{tab.badge}</span>{/if}
{/snippet}

<svelte:window
	onkeydown={(event) => {
		if (event.defaultPrevented) return;
		const mod = event.metaKey || event.ctrlKey;
		if (mod && event.key.toLowerCase() === 'k' && !event.shiftKey && !event.altKey) {
			event.preventDefault();
			shellState.paletteOpen = !shellState.paletteOpen;
			return;
		}
		if (mod && event.key === ',') {
			event.preventDefault();
			modelSettingsUi.show();
			return;
		}
		// Ctrl+Tab / Ctrl+Shift+Tab: next / previous tab (Home, then sessions), wrapping.
		if (event.ctrlKey && event.key === 'Tab' && !event.altKey && !event.metaKey) {
			if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
			event.preventDefault();
			const order = [HOME, ...tabs.map((tab) => tab.id)];
			const at = order.indexOf(activeValue);
			const step = event.shiftKey ? -1 : 1;
			navigate(order[at < 0 ? (step > 0 ? 0 : order.length - 1) : (at + step + order.length) % order.length]);
			return;
		}
		if (mod && (event.key === '1' || event.key === '2') && paletteContext.showView) {
			event.preventDefault();
			paletteContext.showView(event.key === '1' ? 'conversation' : 'diff');
			return;
		}
		// R: review a pull request, unless typing or a dialog is open.
		const target = event.target as HTMLElement | null;
		if (
			event.key.toLowerCase() === 'r' &&
			!mod &&
			!event.altKey &&
			!event.shiftKey &&
			!target?.closest('input, textarea, select, [contenteditable="true"]') &&
			!document.querySelector('[role="dialog"], [role="alertdialog"]')
		) {
			event.preventDefault();
			void newReview();
		}
	}}
/>

<header class="top-bar flex h-[46px] shrink-0 items-center gap-1 bg-chrome pr-[10px] pl-2 select-none">

	<nav aria-label="Sessions" class="relative flex min-w-0 flex-1 items-center" bind:clientWidth={regionWidth}>
		<ContextMenu.Root>
		<ContextMenu.Trigger class="flex min-w-0 flex-1 items-center" {@attach trackMenuTab}>
		<Tabs.Root value={activeValue} onValueChange={navigate} variant="segmented" class="top-tabs min-w-0">
			<Tabs.List {...{ 'aria-label': 'Open sessions' }} {@attach keepPillAligned}>
				<Tabs.Trigger value={HOME} {...{ 'aria-controls': 'app-canvas' }}>
					<Inbox size={14} strokeWidth={1.75} aria-hidden="true" />
					Home
					{#if openPrs.count}<span class="font-mono text-[11.5px] text-fg-faint" aria-label="{openPrs.count} open pull requests">{openPrs.count}</span>{/if}
				</Tabs.Trigger>
				{#if tabs.length > 0}
					<span class="tab-sep mx-1.5 h-4 w-px shrink-0 bg-line-tab" aria-hidden="true"></span>
				{/if}
				{#each visibleTabs as tab (tab.id)}
					<Tabs.Trigger
						value={tab.id}
						{...{
							'aria-controls': 'app-canvas',
							'data-tab': tab.id,
							title: `${tab.title} · ${tab.repo} ${tab.pr ?? ''}`,
							onauxclick: (event: MouseEvent) => {
								if (event.button === 1) {
									event.preventDefault();
									void closeSessionTab(tab.id);
								}
							}
						}}
					>
						{@render tabBody(tab)}
					</Tabs.Trigger>
				{/each}
			</Tabs.List>
		</Tabs.Root>

		{#if hiddenTabs.length > 0}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					variant="ghost"
					class="h-7 shrink-0 gap-1 px-2 font-mono text-[11px] text-fg-faint"
					aria-label="{hiddenTabs.length} more sessions"
				>
					+{hiddenTabs.length}
					<ChevronDown size={12} aria-hidden="true" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content class="min-w-[240px]">
					{#each hiddenTabs as tab (tab.id)}
						<DropdownMenu.Item callback={() => navigate(tab.id)}>
							<span class="flex min-w-0 flex-1 items-center gap-[7px]">{@render tabBody(tab)}</span>
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		{/if}

		{#if tabs.length > 0}
			<Tooltip.Root delay={600}>
				<Tooltip.Trigger class="flex shrink-0">
					<Button variant="ghost" size="icon" class="top-plus" aria-label="Review a pull request" onclick={() => void newReview()}>
						<Plus size={14} aria-hidden="true" />
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>Review a pull request</Tooltip.Content>
			</Tooltip.Root>
		{/if}

		</ContextMenu.Trigger>
		<ContextMenu.Content class="min-w-[13rem]">
			{#if menuTab}
				{@const tab = menuTab}
				{#if tab.id !== activeValue}
					<ContextMenu.Item callback={() => navigate(tab.id)}>Open</ContextMenu.Item>
				{/if}
				<ContextMenu.Item callback={() => void goto(`/session/${tab.id}?view=diff`)}>Open diff</ContextMenu.Item>
				{#if menuTabUrl}
					{@const url = menuTabUrl}
					<ContextMenu.Item callback={() => void navigator.clipboard?.writeText(url).catch(() => {})}>Copy pull request link</ContextMenu.Item>
				{/if}
				<ContextMenu.Separator />
				<ContextMenu.Item callback={() => void closeSessionTab(tab.id)}>Close tab</ContextMenu.Item>
				<ContextMenu.Item disabled={tabs.length < 2} callback={() => void closeTabs(tabs.filter((t) => t.id !== tab.id))}>
					Close other tabs
				</ContextMenu.Item>
				<ContextMenu.Item
					disabled={tabs.at(-1)?.id === tab.id}
					callback={() => void closeTabs(tabs.slice(tabs.findIndex((t) => t.id === tab.id) + 1))}
				>
					Close tabs to the right
				</ContextMenu.Item>
				<ContextMenu.Separator />
				<ContextMenu.Item class="menu-danger" callback={() => requestDeleteSession(tab.id)}>Delete session</ContextMenu.Item>
			{:else}
				<ContextMenu.Item callback={() => void newReview()}>Review a pull request…</ContextMenu.Item>
				<ContextMenu.Item disabled={tabs.length === 0} callback={() => void closeTabs(tabs)}>Close all tabs</ContextMenu.Item>
			{/if}
		</ContextMenu.Content>
		</ContextMenu.Root>

		<!-- Measures every tab at rest so overflow can be computed without flicker. -->
		<div bind:this={measureEl} class="top-tabs-measure" aria-hidden="true">
			<span class="top-tab-measure">
				<Inbox size={14} strokeWidth={1.75} />Home{#if openPrs.count}<span class="font-mono text-[11.5px]">{openPrs.count}</span>{/if}<span class="mx-1.5 h-4 w-px"></span>
			</span>
			{#each tabs as tab (tab.id)}
				<span class="top-tab-measure">{@render tabBody(tab)}</span>
			{/each}
		</div>
	</nav>

	<Button
		variant="quiet"
		class="search-trigger"
		aria-label="Search or ask Recoder"
		aria-haspopup="dialog"
		onclick={() => (shellState.paletteOpen = true)}
	>
		<Search size={14} aria-hidden="true" />
		<span class="min-w-0 flex-1 truncate text-left">Search or ask Recoder</span>
		<Shortcut shortcut="cmd+k" class="keycap" />
	</Button>

	{#if shellState.usage}
		{@const usage = shellState.usage}
		<Tooltip.Root delay={400}>
			<Tooltip.Trigger class="flex shrink-0">
				<Button
					variant="ghost"
					class="usage-meter"
					aria-label="ChatGPT usage {usage.percent}% of {usage.name}"
					aria-haspopup="dialog"
					onclick={() => (shellState.usageOpen = true)}
				>
					<Progress value={usage.percent} class="usage-track h-[3px] w-[26px] rounded-[2px] bg-hover" {...{ 'aria-hidden': 'true' }} />
					{usage.percent}%
				</Button>
			</Tooltip.Trigger>
			<Tooltip.Content>{usage.name} · {usage.percent}% used</Tooltip.Content>
		</Tooltip.Root>
	{/if}

	<Tooltip.Root delay={600}>
		<Tooltip.Trigger class="flex shrink-0">
			<Button variant="ghost" size="icon" aria-label="Settings" onclick={() => modelSettingsUi.show()}>
				<SlidersHorizontal size={15} aria-hidden="true" />
			</Button>
		</Tooltip.Trigger>
		<Tooltip.Content>Settings</Tooltip.Content>
	</Tooltip.Root>

	<DropdownMenu.Root>
		<DropdownMenu.Trigger
			variant="quiet"
			size="icon"
			class="top-avatar-trigger"
			aria-label={shellState.account ? `Account: ${shellState.account.user}` : 'Account'}
		>
			<Avatar.Root class="size-[26px] bg-selected text-[10.5px] font-medium text-fg-secondary">
				<Avatar.Fallback>{shellState.account ? initials(shellState.account.user) : '··'}</Avatar.Fallback>
			</Avatar.Root>
		</DropdownMenu.Trigger>
		<DropdownMenu.Content class="min-w-[220px]">
			<DropdownMenu.Label>
				{#if shellState.account}
					Signed in as <span class="font-mono text-fg-subtle">{shellState.account.user}</span>
				{:else}
					Not signed in to GitHub or GitLab
				{/if}
			</DropdownMenu.Label>
			<DropdownMenu.Separator />
			<DropdownMenu.Item callback={() => modelSettingsUi.show()}>Settings</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
</header>
