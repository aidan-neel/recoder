<script lang="ts">
	interface Props {
		text: string;
	}

	let { text }: Props = $props();

	/** Model prose marks code with backticks; everything else stays plain text. */
	const parts = $derived(text.split(/(`[^`\n]+`)/g).filter(Boolean));
</script>

{#each parts as part, index (index)}{#if part.startsWith('`') && part.endsWith('`') && part.length > 2}<code
			class="inline-code">{part.slice(1, -1)}</code
		>{:else}{part}{/if}{/each}
