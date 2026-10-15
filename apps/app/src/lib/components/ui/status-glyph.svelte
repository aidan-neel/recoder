<script lang="ts" module>
	/**
	 * One 16px glyph for every state an item can be in, so the queue, the rail
	 * and the file list read alike. A change of kind crossfades and settles.
	 */
	export type GlyphKind =
		'high' | 'medium' | 'low' | 'question' | 'spinner' | 'ok' | 'sent' | 'dismissed' | 'idle' | 'failed' | 'outdated';
</script>

<script lang="ts">
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import Check from '@lucide/svelte/icons/check';
	import GitCommitHorizontal from '@lucide/svelte/icons/git-commit-horizontal';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import X from '@lucide/svelte/icons/x';

	interface Props {
		kind: GlyphKind;
		class?: string;
	}

	let { kind, class: className = '' }: Props = $props();
</script>

<span class="glyph {className}" data-kind={kind} aria-hidden="true">
	{#key kind}
		<span class="glyph-face">
			{#if kind === 'spinner'}
				<svg class="glyph-spinner" viewBox="0 0 16 16" fill="none">
					<circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.6" opacity="0.2" />
					<path d="M13.5 8A5.5 5.5 0 0 0 8 2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
				</svg>
			{:else if kind === 'ok'}
				<Check size={11} strokeWidth={2.5} />
			{:else if kind === 'sent'}
				<ArrowUpRight size={11} strokeWidth={2.5} />
			{:else if kind === 'dismissed'}
				<X size={10} strokeWidth={2.5} />
			{:else if kind === 'failed'}
				<TriangleAlert size={13} strokeWidth={2} />
			{:else if kind === 'outdated'}
				<GitCommitHorizontal size={14} strokeWidth={2} />
			{:else if kind === 'question'}
				<span class="glyph-q">?</span>
			{:else}
				<span class="glyph-dot"></span>
			{/if}
		</span>
	{/key}
</span>
