<script lang="ts">
	import { onMount } from 'svelte';
	import { Toaster } from '@sivir-ui/svelte/components/toast';
	import favicon from '$web/assets/favicon.svg';
	import GuidelinesEditor from '$web/components/settings/guidelines-editor.svelte';
	import SettingsModal from '$lib/components/settings/settings-modal.svelte';
	import CommandPalette from '$lib/components/shell/command-palette.svelte';
	import ShortcutsModal from '$lib/components/shell/shortcuts-modal.svelte';
	import AppCanvas from '$web/components/shell/app-canvas.svelte';
	import TopBar from '$lib/components/shell/top-bar.svelte';
	import { listenKeys } from '$lib/shell/keys';
	import { shell } from '$lib/shell/shell.svelte';
	import { modelSettingsUi } from '$web/settings/model-settings.svelte';
	import { theme } from '$web/settings/theme.svelte';
	import '../app.css';

	let { children } = $props();

	onMount(() => {
		theme.init();

		return listenKeys(() => ({
			'mod+k': () => (shell.paletteOpen = !shell.paletteOpen),
			'?': () => (shell.shortcutsOpen = true),
			'mod+,': () => modelSettingsUi.show(modelSettingsUi.section)
		}));
	});

	/**
	 * Sivir's Toaster portals to <body> without marking itself an overlay root, so an open modal would
	 * inert it and its Undo button would stop responding.
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
	<title>Recoder</title>
</svelte:head>

<div class="flex h-dvh flex-col overflow-hidden bg-chrome text-fg">
	<TopBar />
	<AppCanvas>
		{@render children()}
	</AppCanvas>
	<SettingsModal />
	<GuidelinesEditor />
	<CommandPalette />
	<ShortcutsModal />
	<Toaster />
</div>
