<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import ModelSettingsModal from '$lib/components/model-settings-modal.svelte';
	import Menu from '@lucide/svelte/icons/menu';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import { appSidebarState } from '$lib/app-sidebar-state.svelte';
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Recoder — self-hosted PR reviews</title>
	<meta
		name="description"
		content="Recoder is a self-hosted, OpenCode-style pull request reviewer you run with Docker."
	/>
</svelte:head>

<div class="flex h-dvh overflow-hidden bg-chrome text-foreground">
	<AppSidebar />
	<div class="flex min-w-0 flex-1 flex-col lg:py-2 lg:pe-2">
		<div
			class="flex h-[52px] shrink-0 items-center gap-1 border-b border-border bg-background px-3 lg:hidden"
		>
			<Button
				variant="ghost"
				size="icon"
				onclick={() => (appSidebarState.mobileOpen = true)}
				aria-label="Open sessions sidebar"
			>
				<Menu size={16} />
			</Button>
			<Button href="/" unstyled class="flex min-h-9 items-center gap-2 rounded-md px-1">
				<span class="recoder-mark size-4 bg-primary" aria-hidden="true"></span>
				<span class="text-[16px] font-semibold tracking-tight">Recoder</span>
			</Button>
		</div>
		<main class="flex min-h-0 flex-1">
			<Card.Root class="min-h-0 min-w-0 flex-1 overflow-hidden rounded-none border-0 bg-background p-0 lg:rounded-xl lg:border lg:border-border-subtle">
				{@render children()}
			</Card.Root>
		</main>
	</div>
	<ModelSettingsModal />
</div>
