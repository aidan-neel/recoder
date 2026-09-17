<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import Hash from '@lucide/svelte/icons/hash';
	import Link2 from '@lucide/svelte/icons/link-2';
	import PanelLeftClose from '@lucide/svelte/icons/panel-left-close';
	import PanelLeftOpen from '@lucide/svelte/icons/panel-left-open';
	import Plus from '@lucide/svelte/icons/plus';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Settings from '@lucide/svelte/icons/settings';
	import X from '@lucide/svelte/icons/x';
	import * as AlertDialog from '@sivir-ui/svelte/components/alert-dialog';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as ContextMenu from '@sivir-ui/svelte/components/context-menu';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import * as Sheet from '@sivir-ui/svelte/components/sheet';
	import Shortcut from '@sivir-ui/svelte/components/shortcut';
	import { Skeleton } from '@sivir-ui/svelte/components/skeleton';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import * as Tooltip from '@sivir-ui/svelte/components/tooltip';
	import { appSidebarState } from '$lib/app-sidebar-state.svelte';
	import { modelSettingsUi } from '$lib/model-settings.svelte';
	import {
		recentHeadline,
		recentSessions,
		recentStatusLabel,
		type RecentSession
	} from '$lib/recent-sessions.svelte';
	import { sessionState } from '$lib/session-state.svelte';
	import { theme } from '$lib/theme.svelte';

	const statusDot = {
		passed: '#3fb96c',
		running: '#5b8cff',
		queued: '#8a8f98',
		failed: '#e0655f'
	} as const;

	let closingId = $state<string | null>(null);
	let pendingCloseId = $state<string | null>(null);
	let closeDialogOpen = $state(false);
	const pendingClose = $derived(
		recentSessions.recent.find((s) => s.id === pendingCloseId) ?? null
	);

	onMount(() => {
		theme.ensureLoaded();
		void recentSessions.load();
	});

	function openReview(session: RecentSession): void {
		const status =
			session.status === 'passed' || session.status === 'failed' ? 'ready' : 'reviewing';
		sessionState.ensureSession(session.id, session.repo, `#${session.pr}`, status);
		appSidebarState.closeMobile();
		void goto(`/session/${session.id}`);
	}

	function copySessionLink(id: string): void {
		const url = `${window.location.origin}/session/${id}`;
		void navigator.clipboard?.writeText(url).catch(() => {});
	}

	function copySessionId(id: string): void {
		void navigator.clipboard?.writeText(id).catch(() => {});
	}

	function requestClose(id: string): void {
		pendingCloseId = id;
		closeDialogOpen = true;
	}

	function confirmClose(): void {
		const id = pendingCloseId;
		pendingCloseId = null;
		closeDialogOpen = false;
		if (id) void closeSession(id);
	}

	/** Closing a session deletes it permanently (after confirmation). */
	async function closeSession(id: string): Promise<void> {
		if (closingId) return;
		closingId = id;
		try {
			await recentSessions.deleteReview(id);
			// Drop the matching tab too, if one is open.
			const viewing = page.url.pathname === `/session/${id}`;
			sessionState.close(id);
			if (viewing) {
				const next = sessionState.activeId;
				void goto(next ? `/session/${next}` : '/');
			}
		} finally {
			closingId = null;
		}
	}

	function goHome(): void {
		appSidebarState.closeMobile();
		void goto('/');
	}
</script>

{#snippet sessionRow(session: RecentSession)}
	{@const active = page.url.pathname === `/session/${session.id}`}
	{@const title = session.title?.trim() ? session.title : `PR #${session.pr}`}
	<ContextMenu.Root>
		<div
			class="group flex w-full items-start rounded-md border-[length:var(--border-size)] border-border bg-card transition-colors hover:bg-secondary {active
				? 'border-primary/60 bg-primary/[0.05]'
				: ''}"
		>
			<ContextMenu.Trigger
				{...{
					onclick: () => openReview(session),
					'aria-label': `Open ${title} in ${session.repo}`,
					'aria-current': active ? 'page' : undefined
				}}
				class="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 p-2.5 text-left"
			>
				<span class="flex min-w-0 items-center gap-2">
					<span class="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
						{title}
					</span>
					<span class="flex shrink-0 items-center gap-1.5">
						{#if session.status === 'running' || session.status === 'queued'}
							<Spinner size={12} aria-hidden="true" />
						{:else}
							<span
								class="h-1.5 w-1.5 rounded-full"
								style:background-color={statusDot[session.status]}
							></span>
						{/if}
						<span
							class:text-success={session.status === 'passed'}
							class:text-error={session.status === 'failed'}
							class:text-info-vivid={session.status === 'running' ||
								session.status === 'queued'}
							class="text-[12px] font-medium"
						>
							{recentStatusLabel(session)}
						</span>
					</span>
				</span>
				<span class="truncate font-mono text-[12px] text-foreground-muted">
					#{session.pr} · {recentHeadline(session)}
				</span>
			</ContextMenu.Trigger>
			<Button
				variant="ghost"
				size="icon"
				onclick={() => requestClose(session.id)}
				aria-label="Close {title} in {session.repo}"
				title="Close session"
				class="mr-1 mt-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
			>
				<X size={13} />
			</Button>
		</div>
		<ContextMenu.Content class="min-w-[13rem]">
			<ContextMenu.Item callback={() => openReview(session)}>
				<span class="flex items-center gap-2"><ArrowUpRight size={14} /> Open session</span>
			</ContextMenu.Item>
			<ContextMenu.Item callback={() => copySessionLink(session.id)}>
				<span class="flex items-center gap-2"><Link2 size={14} /> Copy link</span>
			</ContextMenu.Item>
			<ContextMenu.Item callback={() => copySessionId(session.id)}>
				<span class="flex items-center gap-2"><Hash size={14} /> Copy session ID</span>
			</ContextMenu.Item>
			<ContextMenu.Separator />
			<ContextMenu.Item callback={() => requestClose(session.id)}>
				<span class="flex items-center gap-2 text-[var(--color-error)]">
					<X size={14} /> Close session
				</span>
			</ContextMenu.Item>
		</ContextMenu.Content>
	</ContextMenu.Root>
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
					<span class="truncate text-[16px] font-medium tracking-tight">Recoder</span>
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
			<div class="flex items-baseline justify-between gap-2 px-2 pt-2">
				<p class="m-0 text-[12px] font-medium text-foreground-muted">
					Sessions
					<span class="ml-1 tabular-nums">{recentSessions.recent.length}</span>
				</p>
				{#if recentSessions.reviewingCount > 0}
					<span class="flex shrink-0 items-center gap-1 text-[12px] text-foreground-muted">
						<Spinner size={11} aria-hidden="true" />
						{recentSessions.reviewingCount} in progress
					</span>
				{:else}
					<Button
						variant="quiet"
						class="h-auto shrink-0 px-0 font-sans text-[12px] text-foreground-muted hover:bg-transparent hover:text-foreground"
						loading={recentSessions.loading}
						onclick={() => void recentSessions.refresh()}
					>
						<RefreshCw size={12} aria-hidden="true" /> Refresh
					</Button>
				{/if}
			</div>
		{/if}

		<ScrollArea class="min-h-0 flex-1" showCues={false} aria-label="Sessions">
			{#if expanded}
				<div class="flex flex-col gap-3 px-0.5" aria-busy={recentSessions.loading}>
					{#if recentSessions.loading}
						{#each [0, 1, 2] as i (i)}
							<div class="flex flex-col gap-2 rounded-md border border-border bg-card p-2.5">
								<div class="flex items-center gap-2">
									<Skeleton class="h-[16px] w-24" />
									<Skeleton class="ml-auto h-[16px] w-14" />
								</div>
								<Skeleton class="h-[14px] w-36" />
							</div>
						{/each}
					{:else if recentSessions.recent.length === 0}
						<p class="px-2 py-1 text-[13px] text-foreground-muted">
							{recentSessions.apiDown
								? 'API unreachable — no sessions to show.'
								: 'No sessions yet. Review a pull request to start one.'}
						</p>
					{:else}
						{#each recentSessions.recentByRepo as [repoName, sessions] (repoName)}
							{@const groupReviewing = sessions.filter(
								(s) => s.status === 'running' || s.status === 'queued'
							).length}
							<section class="flex min-w-0 flex-col gap-1.5" aria-label="Sessions in {repoName}">
								<div class="flex items-center gap-1.5 px-1">
									<h3 class="min-w-0 flex-1 truncate font-mono text-[12px] font-medium text-foreground-muted">
										{repoName}
									</h3>
									{#if groupReviewing > 0}
										<Spinner size={11} aria-hidden="true" />
									{/if}
									<span class="shrink-0 text-[12px] text-foreground-muted tabular-nums">{sessions.length}</span>
								</div>
								{#each sessions as session (session.id)}
									{@render sessionRow(session)}
								{/each}
							</section>
						{/each}
					{/if}
				</div>
			{:else}
				<div class="flex flex-col items-center gap-0.5">
					{#each recentSessions.recent as session (session.id)}
						{@const active = page.url.pathname === `/session/${session.id}`}
						{@const title = session.title?.trim() ? session.title : `PR #${session.pr}`}
						<Tooltip.Root placement="right" delay={1500}>
							<Tooltip.Trigger class="flex justify-center">
								<Button
									unstyled
									onclick={() => openReview(session)}
									aria-label="Open {title} in {session.repo}"
									aria-current={active ? 'page' : undefined}
									class="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors {active
										? 'bg-secondary'
										: 'hover:bg-secondary/60'}"
								>
									{#if session.status === 'running' || session.status === 'queued'}
										<Spinner size={12} aria-hidden="true" />
									{:else}
										<span
											class="h-2 w-2 rounded-full"
											style:background-color={statusDot[session.status]}
										></span>
									{/if}
								</Button>
							</Tooltip.Trigger>
							<Tooltip.Content>
								{title} · {session.repo} #{session.pr}
							</Tooltip.Content>
						</Tooltip.Root>
					{/each}
				</div>
			{/if}
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
		: 'w-[360px]'}"
>
	{@render sidebarNav(!appSidebarState.collapsed)}
</aside>

<Sheet.Root
	open={appSidebarState.mobileOpen}
	onOpenChange={(v) => (appSidebarState.mobileOpen = v)}
>
	<Sheet.Content side="left" class="w-[360px] [&>[data-ui=sheet-surface]]:p-0">
		<Sheet.Title class="sr-only">Sessions</Sheet.Title>
		{@render sidebarNav(true)}
	</Sheet.Content>
</Sheet.Root>

<AlertDialog.Root
	error
	bind:open={closeDialogOpen}
	onOpenChange={(open) => {
		if (!open) pendingCloseId = null;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Close this session?</AlertDialog.Title>
			<AlertDialog.Description>
				{#if pendingClose}
					{pendingClose.title?.trim() ? pendingClose.title : `PR #${pendingClose.pr}`} in {pendingClose.repo}
					will be permanently removed.
				{:else}
					This session will be permanently removed.
				{/if}
				This action cannot be undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Exit>
				Cancel
				<Shortcut shortcut="esc" />
			</AlertDialog.Exit>
			<AlertDialog.Confirm onclick={() => confirmClose()}>
				Close session
				<Shortcut shortcut="enter" />
			</AlertDialog.Confirm>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
