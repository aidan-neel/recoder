<script lang="ts">
	import { goto } from '$app/navigation';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { sessionState } from '$lib/session-state.svelte';
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
			{@const active = session.id === sessionState.activeId}
			<div
				role="tab"
				aria-selected={active}
				class="group flex h-9 shrink-0 items-center rounded-md pr-1 transition-colors {active
					? 'bg-secondary text-foreground'
					: 'text-foreground-muted hover:bg-secondary/60 hover:text-foreground'}"
			>
			<button
				onclick={() => {
					sessionState.select(session.id);
					void goto(`/session/${session.id}`);
				}}
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
				<button
					onclick={() => sessionState.close(session.id)}
					aria-label="Close {session.name}"
					title="Close {session.name}"
					class="ml-1 flex h-6 w-6 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-foreground/10"
				>
					<X size={13} />
				</button>
			</div>
		{/each}
		<Button
			variant="ghost"
			size="icon"
			onclick={() => {
				const created = sessionState.add();
				void goto(`/session/${created.id}`);
			}}
			aria-label="New session"
			title="New session"
		>
			<Plus size={14} />
		</Button>
	</div>
</header>
