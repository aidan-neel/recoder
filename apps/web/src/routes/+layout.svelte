<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import ModelSettingsModal from '$lib/components/model-settings-modal.svelte';
	import SessionBar from '$lib/components/session-bar.svelte';
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

<div class="flex min-h-screen flex-col bg-background text-foreground">
	<SessionBar />
	<main class="min-h-0 flex-1">
		{@render children()}
	</main>
	<ModelSettingsModal />
</div>
