<script lang="ts">
	import type { FileClass } from '$lib/review/files';
	import type { Attention } from '$lib/review/surface';

	interface Props {
		attention: Attention;
		/** Draw the legend under the bar. */
		legend?: boolean;
		class?: string;
	}

	let { attention, legend = true, class: className = '' }: Props = $props();

	const SEGMENTS: { cls: FileClass; label: string; note: string }[] = [
		{ cls: 'read', label: 'Read', note: 'Hunks with an open decision, or no reviewer' },
		{ cls: 'checked', label: 'Checked', note: 'Examined by reviewers, nothing open' },
		{ cls: 'tests', label: 'Tests', note: 'Test code: evidence, not behavior' },
		{ cls: 'skim', label: 'Skim', note: 'Lockfiles, docs, generated output' }
	];

	let focus = $state<FileClass | null>(null);
</script>

<div class="change-map {className}" data-focus={focus}>
	<div class="change-bar" role="img" aria-label="{attention.read} of {attention.total} changed lines need reading">
		{#each SEGMENTS as segment (segment.cls)}
			<span
				class="change-seg"
				data-cls={segment.cls}
				data-dim={focus !== null && focus !== segment.cls}
				style:flex-grow={attention[segment.cls]}
			></span>
		{/each}
	</div>
	{#if legend}
		<ul class="change-legend">
			{#each SEGMENTS as segment (segment.cls)}
				<li
					class="change-key"
					data-cls={segment.cls}
					data-empty={attention[segment.cls] === 0}
					title={segment.note}
					onpointerenter={() => (focus = segment.cls)}
					onpointerleave={() => (focus = null)}
				>
					<span class="change-swatch" aria-hidden="true"></span>
					{segment.label}
					<span class="change-count mono tabular">{attention[segment.cls]}</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
