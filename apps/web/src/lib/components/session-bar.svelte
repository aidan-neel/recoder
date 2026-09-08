<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Copy from '@lucide/svelte/icons/copy';
	import Link2 from '@lucide/svelte/icons/link-2';
	import ListX from '@lucide/svelte/icons/list-x';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Settings from '@lucide/svelte/icons/settings';
	import X from '@lucide/svelte/icons/x';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as ContextMenu from '@sivir-ui/svelte/components/context-menu';
	import { modelSettingsUi } from '$lib/model-settings.svelte';
	import { sessionState } from '$lib/session-state.svelte';

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

	let renamingId = $state<string | null>(null);
	let renameDraft = $state('');

	function startRename(id: string, name: string): void {
		renamingId = id;
		renameDraft = name;
	}

	function commitRename(id: string): void {
		if (renamingId === id) {
			sessionState.rename(id, renameDraft);
			renamingId = null;
		}
	}

	function cancelRename(): void {
		renamingId = null;
	}

	function focusInput(node: HTMLInputElement): void {
		node.focus();
		node.select();
	}
</script>

<header class="flex h-[52px] shrink-0 items-center gap-1 bg-background px-3">
	<a href="/" class="mr-4 flex shrink-0 items-center gap-2">
		<span class="h-4 w-4 rounded-[4px] bg-primary"></span>
		<span class="text-[16px] font-semibold tracking-tight">Recoder</span>
	</a>
	<div
		role="tablist"
		aria-label="Sessions"
		class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
	>
		{#each sessionState.sessions as session (session.id)}
			{@const active = page.url.pathname === `/session/${session.id}`}
			<ContextMenu.Root>
				<ContextMenu.Trigger class="shrink-0">
					<div
						role="tab"
						aria-selected={active}
						class="group flex h-9 shrink-0 items-center rounded-md pr-1 transition-colors {active
							? 'bg-secondary text-foreground'
							: 'text-foreground-muted hover:bg-secondary/60 hover:text-foreground'}"
					>
					{#if renamingId === session.id}
						<input
							use:focusInput
							value={renameDraft}
							oninput={(e) => (renameDraft = e.currentTarget.value)}
							onkeydown={(e) => {
								if (e.key === 'Enter') commitRename(session.id);
								else if (e.key === 'Escape') cancelRename();
								e.stopPropagation();
							}}
							onblur={() => commitRename(session.id)}
							onclick={(e) => e.stopPropagation()}
							aria-label="Rename session"
							class="mx-2 h-7 w-32 rounded border border-border bg-background px-2 text-[15px] text-foreground outline-none focus:border-primary"
						/>
					{:else}
						<button
							onclick={() => {
								sessionState.select(session.id);
								void goto(`/session/${session.id}`);
							}}
							ondblclick={() => startRename(session.id, session.name)}
							aria-label="Switch to {session.name}"
								class="flex h-full items-center gap-2 pl-3 text-[15px]"
							>
								{#if session.status === 'reviewing'}
								<Spinner size={12} aria-hidden="true" />
							{:else}
								<span class="h-1.5 w-1.5 rounded-full" style:background-color={session.color}></span>
							{/if}
								<span class="font-medium">{session.name}</span>
								{#if session.ref}
									<span class="font-mono text-[14px] opacity-70">{session.ref}</span>
								{/if}
							</button>
						{/if}
						<button
							onclick={() => closeSession(session.id)}
							aria-label="Close {session.name}"
							title="Close {session.name}"
							class="ml-1 flex h-6 w-6 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-foreground/10"
						>
							<X size={13} />
						</button>
					</div>
				</ContextMenu.Trigger>
				<ContextMenu.Content class="min-w-[13rem]">
					<ContextMenu.Item callback={() => startRename(session.id, session.name)}>
						<span class="flex items-center gap-2"><Pencil size={14} /> Rename</span>
					</ContextMenu.Item>
					<ContextMenu.Item callback={() => duplicateSession(session.id)}>
						<span class="flex items-center gap-2"><Copy size={14} /> Duplicate</span>
					</ContextMenu.Item>
					<ContextMenu.Item callback={() => copySessionLink(session.id)}>
						<span class="flex items-center gap-2"><Link2 size={14} /> Copy link</span>
					</ContextMenu.Item>
					<ContextMenu.Separator />
					<ContextMenu.Item callback={() => closeOtherSessions(session.id)}>
						<span class="flex items-center gap-2"><ListX size={14} /> Close other sessions</span>
					</ContextMenu.Item>
					<ContextMenu.Item callback={() => closeSession(session.id)}>
						<span class="flex items-center gap-2 text-[var(--color-error)]">
							<X size={14} /> Close session
						</span>
					</ContextMenu.Item>
				</ContextMenu.Content>
			</ContextMenu.Root>
		{/each}
		<Button
			variant="ghost"
			size="icon"
			onclick={() => void goto('/')}
			aria-label="New session"
			title="New session"
		>
			<Plus size={14} />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			onclick={() => modelSettingsUi.show()}
			aria-label="Reviewer model settings"
			title="Reviewer model settings"
		>
			<Settings size={14} />
		</Button>
	</div>
</header>
