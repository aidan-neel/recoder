<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import Hash from '@lucide/svelte/icons/hash';
	import Link2 from '@lucide/svelte/icons/link-2';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import Settings from '@lucide/svelte/icons/settings';
	import SquarePen from '@lucide/svelte/icons/square-pen';
	import X from '@lucide/svelte/icons/x';
	import * as AlertDialog from '@sivir-ui/svelte/components/alert-dialog';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as ContextMenu from '@sivir-ui/svelte/components/context-menu';
	import { Input } from '@sivir-ui/svelte/components/input';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import * as Sheet from '@sivir-ui/svelte/components/sheet';
	import Shortcut from '@sivir-ui/svelte/components/shortcut';
	import { Skeleton } from '@sivir-ui/svelte/components/skeleton';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import * as Tooltip from '@sivir-ui/svelte/components/tooltip';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import { appSidebarState } from '$lib/app-sidebar-state.svelte';
	import { modelSettingsUi } from '$lib/model-settings.svelte';
	import { recentSessions, type RecentSession } from '$lib/recent-sessions.svelte';
	import { sessionState } from '$lib/session-state.svelte';
	import { theme } from '$lib/theme.svelte';

	const statusDot = {
		draft: 'var(--color-foreground-muted)',
		passed: 'var(--color-success)',
		running: 'var(--color-info-vivid)',
		queued: 'var(--color-foreground-muted)',
		failed: 'var(--color-error)'
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
		const status = session.status === 'running' || session.status === 'queued' ? 'reviewing' : 'ready';
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

	let sessionQuery = $state('');

	const filteredSessions = $derived.by(() => {
		const q = sessionQuery.trim().toLowerCase();
		return recentSessions.recent.filter((session) =>
			`${session.repo} ${session.title ?? ''} ${session.branch ?? ''} #${session.pr}`.toLowerCase().includes(q)
		);
	});
</script>

{#snippet sessionRow(session: RecentSession)}
	{@const active = page.url.pathname === `/session/${session.id}`}
	{@const title = session.title?.trim() ? session.title : `PR #${session.pr}`}
	<ContextMenu.Root>
		<div class="flex w-full items-start">
			<ContextMenu.Trigger
				{...{
					onclick: () => openReview(session),
					onkeydowncapture: (event: KeyboardEvent) => {
						if (event.key === 'Enter' || event.key === ' ') {
							event.preventDefault();
							openReview(session);
						}
					},
					onpointerupcapture: (event: PointerEvent) => {
						if (event.pointerType === 'touch') event.stopPropagation();
					},
					'aria-label': `Open ${title} in ${session.repo}`,
					'aria-current': active ? 'page' : undefined
				}}
				class="review-row session-row -mx-1 flex min-w-0 flex-1 flex-col gap-1 rounded-lg px-2 py-2 text-left transition-colors hover:cursor-default {active
					? 'bg-secondary'
					: 'hover:bg-secondary aria-expanded:bg-secondary'}"
			>
				<span class="flex w-full min-w-0 items-center gap-2">
					<Typography.Metadata class="min-w-0 flex-1 truncate text-sm font-normal text-foreground" title={session.repo}>
						{session.repo.split('/').at(-1)} code review <span class="font-mono text-foreground-muted">#{session.pr}</span>
					</Typography.Metadata>
					<span class="flex shrink-0 items-center gap-1 text-[11px]" style:color={statusDot[session.status]}>
						{#if session.status === 'running'}<Spinner size={10} aria-hidden="true" />{:else}<span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>{/if}
						{session.status === 'draft' ? 'Not started' : session.status === 'passed' ? 'Passed' : session.status === 'failed' ? 'Failed' : session.status === 'queued' ? 'Queued' : 'Reviewing'}
					</span>
				</span>
				<Typography.Metadata class="w-full truncate font-mono text-xs font-normal text-foreground-muted" title={title}>
					{title}
				</Typography.Metadata>
				{#if session.branch}
					<Typography.InlineCode class="max-w-full truncate self-start rounded-sm px-1.5 py-0.5 text-[12px] leading-4 font-normal text-foreground-muted" title={session.branch}>
						{session.branch}
					</Typography.InlineCode>
				{/if}
			</ContextMenu.Trigger>
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

{#snippet sidebarNav(expanded: boolean, mobile = false)}
	<div class="flex h-full flex-col gap-3 overflow-hidden select-none {expanded ? 'p-3' : 'p-2'}">
		<div class="flex min-h-10 shrink-0 items-center gap-1">
			<Button
				href="/"
				unstyled
				onclick={() => appSidebarState.closeMobile()}
				aria-label="Recoder home"
				class="flex min-h-9 min-w-0 cursor-pointer items-center gap-2 rounded-md {expanded
					? 'flex-1 px-2'
					: 'w-full justify-center'}"
			>
				<span class="recoder-mark size-4 shrink-0 bg-primary" aria-hidden="true"></span>
				{#if expanded}
					<span class="truncate text-[14px] font-normal">Recoder</span>
				{/if}
			</Button>
			{#if expanded}
				<Tooltip.Root placement="right" delay={1500}>
					<Tooltip.Trigger class="flex shrink-0">
						<Button
							variant="ghost"
							size="icon"
							onclick={() => mobile ? appSidebarState.closeMobile() : appSidebarState.toggleCollapsed()}
							aria-label={mobile ? 'Close sidebar' : 'Collapse sidebar'}
							aria-expanded="true"
							class="size-9"
						>
							<ChevronLeft size={16} strokeWidth={1.5} aria-hidden="true" />
						</Button>
					</Tooltip.Trigger>
					<Tooltip.Content>{mobile ? 'Close sidebar' : 'Collapse sidebar'}</Tooltip.Content>
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
						<ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>Expand sidebar</Tooltip.Content>
			</Tooltip.Root>
		{/if}

		{#if expanded}
			<div class="flex shrink-0 items-center gap-2 [--color-input:var(--color-border-subtle)] [--elevation-button-outline:inset_0_0_0_1px_var(--color-border-subtle)]">
				<div class="min-w-0 flex-1 [--color-field:transparent] [--radius-lg:10px] [--size-control-md:36px]">
					<Input
						placeholder="Search"
						aria-label="Search sessions"
						class="border-transparent bg-transparent"
						bind:value={sessionQuery}
					>
						{#snippet leading()}
							<Search size={15} />
						{/snippet}
					</Input>
				</div>
				<Button
					variant="outline"
					size="icon"
					onclick={goHome}
					aria-label="New session"
					title="New session"
					class="size-9 shrink-0 rounded-[10px] bg-transparent"
				>
					<SquarePen size={15} />
				</Button>
			</div>
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

		<ScrollArea class="min-h-0 flex-1 {expanded ? '-mx-1' : ''}" showCues={false} aria-label="Sessions">
			{#if expanded}
				<div class="flex flex-col gap-2 px-1" aria-busy={recentSessions.loading}>
					{#if recentSessions.loading}
						{#each [0, 1, 2] as i (i)}
							<div class="flex flex-col gap-2 px-2 py-2">
								<div class="flex items-center justify-between gap-3">
									<Skeleton class="h-4 w-3/5 rounded-md" />
									<Skeleton class="h-3 w-12 rounded-md" />
								</div>
								<Skeleton class="h-3 w-full rounded-md" />
								<Skeleton class="h-5 w-28 rounded-md" />
							</div>
						{/each}
					{:else if filteredSessions.length === 0}
						<Typography.Text variant="supporting" class="px-1 py-1 text-[13px]">
							{sessionQuery.trim() !== ''
								? 'No sessions match your search.'
								: recentSessions.apiDown
									? 'API unreachable — no sessions to show.'
									: 'No sessions yet. Review a pull request to start one.'}
						</Typography.Text>
					{:else}
						{#each filteredSessions as session (session.id)}
							{@render sessionRow(session)}
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
					class="w-full justify-start font-sans font-normal text-foreground-muted"
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
							class="size-9 text-foreground-muted"
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
	class="hidden h-full shrink-0 overflow-hidden bg-chrome transition-[width] duration-200 motion-reduce:transition-none lg:block {appSidebarState.collapsed
		? 'w-14'
		: 'w-[360px]'}"
>
	{@render sidebarNav(!appSidebarState.collapsed)}
</aside>

<Sheet.Root
	open={appSidebarState.mobileOpen}
	onOpenChange={(v) => (appSidebarState.mobileOpen = v)}
>
	<Sheet.Content side="left" class="w-[360px] max-w-[calc(100%-1rem)] [&>[data-ui=sheet-surface]]:bg-chrome [&>[data-ui=sheet-surface]]:p-0">
		<Sheet.Title class="sr-only">Sessions</Sheet.Title>
		{@render sidebarNav(true, true)}
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
