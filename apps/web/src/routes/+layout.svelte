<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import ModelSettingsModal from '$lib/components/model-settings-modal.svelte';
import Menu from '@lucide/svelte/icons/menu';
import { Button } from '@sivir-ui/svelte/components/button';
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

<div class="flex h-dvh overflow-hidden bg-background text-foreground dark:bg-[#111111]">
	<AppSidebar />
	<div class="flex min-w-0 flex-1 flex-col lg:p-2 lg:pl-0">
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
				<span class="h-4 w-4 rounded-[4px] bg-primary"></span>
				<span class="text-[16px] font-semibold tracking-tight">Recoder</span>
			</Button>
		</div>
		<main
			class="min-h-0 flex-1 bg-background lg:overflow-hidden lg:rounded-xl lg:border lg:border-border"
		>
			{@render children()}
		</main>
	</div>
	<ModelSettingsModal />
</div>
