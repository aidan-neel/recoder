<script lang="ts">
	import appleTouchIcon from '$web/assets/apple-touch-icon.png';
	import favicon from '$web/assets/favicon.svg';
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} type="image/svg+xml" />
	<link rel="apple-touch-icon" href={appleTouchIcon} />
</svelte:head>

{@render children()}
