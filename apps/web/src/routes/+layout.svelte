<script lang="ts">
	import appleTouchIcon from '$lib/assets/apple-touch-icon.png';
	import favicon from '$lib/assets/favicon.svg';
	import { Toaster } from '@sivir-ui/svelte/components/toast';
	import CommandPalette from '$lib/components/shell/command-palette.svelte';
	import GuidelinesEditor from '$lib/components/settings/guidelines-editor.svelte';
	import ModelSettingsModal from '$lib/components/settings/model-settings-modal.svelte';
	import UsageModal from '$lib/components/settings/usage-modal.svelte';
	import DeleteSessionDialog from '$lib/components/session/delete-session-dialog.svelte';
	import AppCanvas from '$lib/components/shell/app-canvas.svelte';
	import TopBar from '$lib/components/shell/top-bar.svelte';
	import { theme } from '$lib/settings/theme.svelte';
	import { onMount } from 'svelte';
	import '../app.css';

	let { children } = $props();

	onMount(() => theme.init());

	/**
	 * Sivir's Toaster portals to <body> without marking itself an overlay root, so an open modal inerts it
	 * and toast actions (Undo, View) stop responding. Overlay roots are exempt from that inert.
	 */
	function markToasterOverlayRoot(): void {
		document
			.querySelector('[role="region"][aria-label="Notifications"]')
			?.parentElement?.setAttribute('data-overlay-root', '');
	}

	$effect(markToasterOverlayRoot);
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
	<AppCanvas>
		{@render children()}
	</AppCanvas>
	<ModelSettingsModal />
	<GuidelinesEditor />
	<UsageModal />
	<DeleteSessionDialog />
	<CommandPalette />
	<Toaster />
</div>
