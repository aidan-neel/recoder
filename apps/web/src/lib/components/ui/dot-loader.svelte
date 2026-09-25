<script lang="ts">
	/** 3×3 dot grid; a brightness wave runs corner to corner. Sivir has no equivalent. */
	let { class: className = '' }: { class?: string } = $props();
</script>

<span class="dot-loader {className}" aria-hidden="true">
	{#each Array.from({ length: 9 }, (_, i) => i) as i (i)}
		<span style:--d={(i % 3) + Math.floor(i / 3)}></span>
	{/each}
</span>
