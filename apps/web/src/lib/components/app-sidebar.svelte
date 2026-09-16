<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Copy from '@lucide/svelte/icons/copy';
	import Link2 from '@lucide/svelte/icons/link-2';
	import ListX from '@lucide/svelte/icons/list-x';
	import PanelLeftClose from '@lucide/svelte/icons/panel-left-close';
	import PanelLeftOpen from '@lucide/svelte/icons/panel-left-open';
	import Plus from '@lucide/svelte/icons/plus';
	import Settings from '@lucide/svelte/icons/settings';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as ContextMenu from '@sivir-ui/svelte/components/context-menu';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import * as Sheet from '@sivir-ui/svelte/components/sheet';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import * as Tooltip from '@sivir-ui/svelte/components/tooltip';
	import { appSidebarState } from '$lib/app-sidebar-state.svelte';
	import { modelSettingsUi } from '$lib/model-settings.svelte';
	import { sessionState } from '$lib/session-state.svelte';
	import { theme } from '$lib/theme.svelte';

	onMount(() => theme.ensureLoaded());

	function openSession(id: string): void {
		sessionState.select(id);
		appSidebarState.closeMobile();
		void goto(`/session/${id}`);
	}

	/** Close a tab. Never deletes anything — only Recent sessions > Delete removes a review. */
	function closeSession(id: string): void {
		sessionState.close(id);
		// If we closed the session we're looking at, follow the tab strip.
		if (page.url.pathname === `/session/${id}`) {
			const next = sessionState.activeId;
			void goto(next ? `/session/${next}` : '/');
		}
	}

	function closeOtherSessions(id: string): void {
		sessionState.closeOthers(id);
		if (page.url.pathname.startsWith('/session/') && page.url.pathname !== `/session/${id}`) {
			void goto(`/session/${id}`);
		} else {
			sessionState.select(id);
		}
	}

	function duplicateSession(id: string): void {
		const copy = sessionState.duplicate(id);
		if (copy) void goto(`/session/${copy.id}`);
	}

	function copySessionLink(id: string): void {
		const url = `${window.location.origin}/session/${id}`;
		void navigator.clipboard?.writeText(url).catch(() => {});
	}

	function goHome(): void {
		appSidebarState.closeMobile();
		void goto('/');
	}
</script>

{#snippet sessionMenu(sessionId: string)}
	<ContextMenu.Content class="min-w-[13rem]">
		<ContextMenu.Item callback={() => duplicateSession(sessionId)}>
			<span class="flex items-center gap-2"><Copy size={14} /> Duplicate</span>
		</ContextMenu.Item>
		<ContextMenu.Item callback={() => copySessionLink(sessionId)}>
			<span class="flex items-center gap-2"><Link2 size={14} /> Copy link</span>
		</ContextMenu.Item>
		<ContextMenu.Separator />
		<ContextMenu.Item callback={() => closeOtherSessions(sessionId)}>
			<span class="flex items-center gap-2"><ListX size={14} /> Close other sessions</span>
		</ContextMenu.Item>
		<ContextMenu.Item callback={() => closeSession(sessionId)}>
			<span class="flex items-center gap-2 text-[var(--color-error)]">
				<X size={14} /> Close session
			</span>
		</ContextMenu.Item>
	</ContextMenu.Content>
{/snippet}

{#snippet sidebarNav(expanded: boolean)}
	<div class="flex h-full flex-col gap-1 overflow-hidden p-2 select-none">
		<div class="flex shrink-0 items-center gap-1">
			<Button
				href="/"
				unstyled
				onclick={() => appSidebarState.closeMobile()}
				aria-label="Recoder home"
				class="flex min-h-9 min-w-0 cursor-pointer items-center gap-2 rounded-md {expanded
					? 'flex-1 px-2'
					: 'w-full justify-center'}"
			>
				<span class="h-4 w-4 shrink-0 rounded-[4px] bg-primary"></span>
				{#if expanded}
					<span class="truncate text-[16px] font-semibold tracking-tight">Recoder</span>
				{/if}
			</Button>
			{#if expanded}
				<Tooltip.Root placement="right" delay={1500}>
					<Tooltip.Trigger class="flex shrink-0">
						<Button
							variant="ghost"
							size="icon"
							onclick={() => appSidebarState.toggleCollapsed()}
							aria-label="Collapse sidebar"
							aria-expanded="true"
						>
							<PanelLeftClose size={15} />
						</Button>
					</Tooltip.Trigger>
					<Tooltip.Content>Collapse sidebar</Tooltip.Content>
				</Tooltip.Root>
			{/if}
		</div>
		{#if !expanded}
			<Tooltip.Root placement="right" delay={1500}>
				<Tooltip.Trigger class="flex justify-center">
					<Button
						variant="ghost"
						size="icon"
						onclick={() => appSidebarState.toggleCollapsed()}
						aria-label="Expand sidebar"
						aria-expanded="false"
					>
						<PanelLeftOpen size={15} />
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>Expand sidebar</Tooltip.Content>
			</Tooltip.Root>
		{/if}

		{#if expanded}
			<Button variant="outline" class="w-full shrink-0 justify-start font-sans" onclick={goHome}>
				<Plus size={15} /> New session
			</Button>
		{:else}
			<Tooltip.Root placement="right" delay={1500}>
				<Tooltip.Trigger class="flex justify-center">
					<Button
						variant="outline"
						size="icon"
						onclick={goHome}
						aria-label="New session"
					>
						<Plus size={15} />
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>New session</Tooltip.Content>
			</Tooltip.Root>
		{/if}

		{#if expanded}
			<p class="px-2 pt-2 text-[12px] font-medium text-foreground-muted">
				Sessions
				<span class="ml-1 tabular-nums">{sessionState.sessions.length}</span>
			</p>
		{/if}

		<ScrollArea class="min-h-0 flex-1" showCues={false} aria-label="Sessions">
			<div class="flex flex-col gap-0.5 {expanded ? '' : 'items-center'}">
				{#each sessionState.sessions as session (session.id)}
					{@const active = page.url.pathname === `/session/${session.id}`}
					{#if expanded}
						<ContextMenu.Root>
							<div
								class="group flex min-h-9 shrink-0 items-center rounded-md pr-1 transition-colors {active
									? 'bg-secondary text-foreground'
									: 'text-foreground-muted hover:bg-secondary/60 hover:text-foreground'}"
							>
								<ContextMenu.Trigger
									{...{
										onclick: () => openSession(session.id),
										'aria-label': `Switch to ${session.name}`,
										'aria-current': active ? 'page' : undefined
									}}
									class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-2 pl-2.5 text-left text-[14px]"
								>
									{#if session.status === 'reviewing'}
										<Spinner size={12} aria-hidden="true" />
									{:else}
										<span
											class="h-1.5 w-1.5 shrink-0 rounded-full"
											style:background-color={session.color}
										></span>
									{/if}
									<span class="truncate font-medium">{session.name}</span>
									{#if session.ref}
										<span class="shrink-0 font-mono text-[13px] opacity-70">{session.ref}</span>
									{/if}
								</ContextMenu.Trigger>
								<Button
									variant="ghost"
									size="icon"
									onclick={() => closeSession(session.id)}
									aria-label="Close {session.name}"
									title="Close {session.name}"
									class="ml-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
								>
									<X size={13} />
								</Button>
							</div>
							{@render sessionMenu(session.id)}
						</ContextMenu.Root>
					{:else}
						<Tooltip.Root placement="right" delay={1500}>
							<Tooltip.Trigger class="flex justify-center">
								<Button
									unstyled
									onclick={() => openSession(session.id)}
									aria-label="Switch to {session.name}{session.ref ? ` ${session.ref}` : ''}"
									aria-current={active ? 'page' : undefined}
									class="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors {active
										? 'bg-secondary'
										: 'hover:bg-secondary/60'}"
								>
									{#if session.status === 'reviewing'}
										<Spinner size={12} aria-hidden="true" />
									{:else}
										<span
											class="h-2 w-2 rounded-full"
											style:background-color={session.color}
										></span>
									{/if}
								</Button>
							</Tooltip.Trigger>
							<Tooltip.Content>
								{session.name}{session.ref ? ` ${session.ref}` : ''}
							</Tooltip.Content>
						</Tooltip.Root>
					{/if}
				{:else}
					{#if expanded}
						<p class="px-2 py-1 text-[13px] text-foreground-muted">No sessions yet.</p>
					{/if}
				{/each}
			</div>
		</ScrollArea>

		<div class="shrink-0 pt-2" aria-label="Sidebar settings">
			{#if expanded}
				<Button
					variant="ghost"
					class="w-full justify-start font-sans"
					onclick={() => modelSettingsUi.show()}
				>
					<Settings size={15} /> Settings
				</Button>
			{:else}
				<Tooltip.Root placement="right" delay={1500}>
					<Tooltip.Trigger class="flex justify-center">
						<Button
							variant="ghost"
							size="icon"
							onclick={() => modelSettingsUi.show()}
							aria-label="Settings"
						>
							<Settings size={15} />
						</Button>
					</Tooltip.Trigger>
					<Tooltip.Content>Settings</Tooltip.Content>
				</Tooltip.Root>
			{/if}
		</div>
	</div>
{/snippet}

<aside
	aria-label="Sessions"
	class="hidden h-full shrink-0 overflow-hidden transition-[width] duration-200 lg:block {appSidebarState.collapsed
		? 'w-14'
		: 'w-80'}"
>
	{@render sidebarNav(!appSidebarState.collapsed)}
</aside>

<Sheet.Root
	open={appSidebarState.mobileOpen}
	onOpenChange={(v) => (appSidebarState.mobileOpen = v)}
>
	<Sheet.Content side="left" class="w-[320px] [&>[data-ui=sheet-surface]]:p-0">
		<Sheet.Title class="sr-only">Sessions</Sheet.Title>
		{@render sidebarNav(true)}
	</Sheet.Content>
</Sheet.Root>
