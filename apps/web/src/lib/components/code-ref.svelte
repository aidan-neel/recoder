<script lang="ts">
	import type { ReviewCodeContext } from '@recoder/shared';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { CodeBlock } from '@sivir-ui/svelte/components/code-block';
	import { fileIconUrl } from '$lib/material-icons';
	import { anchorToggle } from '$lib/scroll-anchor';

	/** Code a message was about: a file:line badge that expands to the quoted lines. */
	let { context }: { context: ReviewCodeContext } = $props();
	let open = $state(false);
	let panelEl = $state<HTMLElement>();
	const id = $props.id();
	const name = $derived(context.file.split('/').at(-1) ?? context.file);
	const lines = $derived(context.endLine !== context.startLine ? `${context.startLine}–${context.endLine}` : `${context.startLine}`);
</script>

<div class="code-ref" data-open={open || undefined}>
	<button type="button" class="code-ref-badge" aria-expanded={open} aria-controls="{id}-code"
		title="{context.file}:{lines}{context.side === 'old' ? ' (before)' : ''}" onclick={(event) => { anchorToggle(event.currentTarget, !open, () => panelEl); open = !open; }}>
		<img src={fileIconUrl(name)} alt="" width="14" height="14" class="code-ref-icon" />
		<span class="min-w-0 truncate">{name}:{lines}</span>
		<ChevronRight size={12} class="code-ref-chevron" aria-hidden="true" />
	</button>
	<div id="{id}-code" class="code-ref-panel" inert={!open} bind:this={panelEl}>
		<div class="code-ref-clip">
			<CodeBlock code={context.quote} lang="plaintext" copy="overlay" class="code-ref-code" />
		</div>
	</div>
</div>
