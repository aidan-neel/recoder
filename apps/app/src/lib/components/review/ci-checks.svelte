<script lang="ts">
	import type { PrCheck } from '@recoder/shared';
	import StatusGlyph, { type GlyphKind } from '../ui/status-glyph.svelte';

	interface Props {
		checks: PrCheck[];
	}

	let { checks }: Props = $props();

	const GLYPH: Record<PrCheck['state'], GlyphKind> = {
		passed: 'ok',
		failed: 'failed',
		running: 'spinner',
		pending: 'idle',
		skipped: 'dismissed'
	};

	const ORDER: PrCheck['state'][] = ['failed', 'running', 'pending', 'passed', 'skipped'];
	const sorted = $derived([...checks].sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state)));
</script>

<ul class="ci" aria-label="CI checks">
	{#each sorted as check (check.id ?? check.name)}
		<li>
			<svelte:element
				this={check.url ? 'a' : 'span'}
				class="ci-check"
				data-state={check.state}
				href={check.url ?? undefined}
				target={check.url ? '_blank' : undefined}
				rel={check.url ? 'noreferrer' : undefined}
			>
				<StatusGlyph kind={GLYPH[check.state]} />
				{check.name}
			</svelte:element>
		</li>
	{/each}
</ul>
