<script lang="ts">
	import { page } from '$app/state';
	import appleTouchIcon from '$lib/assets/apple-touch-icon.png';
	import favicon from '$lib/assets/favicon.svg';
	import * as Card from '@sivir-ui/svelte/components/card';
	import { Toaster } from '@sivir-ui/svelte/components/toast';
	import CommandPalette from '$lib/components/command-palette.svelte';
	import GuidelinesEditor from '$lib/components/guidelines-editor.svelte';
	import ModelSettingsModal from '$lib/components/model-settings-modal.svelte';
	import UsageModal from '$lib/components/usage-modal.svelte';
	import DeleteSessionDialog from '$lib/components/delete-session-dialog.svelte';
	import TopBar from '$lib/components/top-bar.svelte';
	import '../app.css';

	let { children } = $props();

	// Sivir's Toaster portals to <body> without marking itself an overlay root,
	// so an open modal inerts it and toast actions (Undo, View) stop responding.
	// Overlay roots are exempt from that inert, so mark the toaster as one.
	$effect(() => {
		document.querySelector('[role="region"][aria-label="Notifications"]')?.parentElement?.setAttribute('data-overlay-root', '');
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} type="image/svg+xml" />
	<link rel="apple-touch-icon" href={appleTouchIcon} />
	<title>Recoder</title>
	<meta
		name="description"
		content="Recoder is a self-hosted, OpenCode-style pull request reviewer you run with Docker."
	/>
</svelte:head>

<div class="flex h-dvh flex-col overflow-hidden bg-chrome text-fg">
	<TopBar />
	<main id="app-canvas" class="flex min-h-0 flex-1 px-2 pb-2" data-route={page.route.id}>
		<Card.Root class="app-canvas min-h-0 min-w-0 flex-1 gap-0 overflow-hidden rounded-[14px] border border-line-canvas bg-canvas p-0 shadow-none">
			{@render children()}
		</Card.Root>
	</main>
	<ModelSettingsModal />
	<GuidelinesEditor />
	<UsageModal />
	<DeleteSessionDialog />
	<CommandPalette />
	<Toaster />
</div>
