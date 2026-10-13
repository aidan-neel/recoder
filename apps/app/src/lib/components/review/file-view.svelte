<script lang="ts">
	import CodeView from './code-view.svelte';
	import { fileLines } from '$lib/review/excerpt';
	import { CLASS_LABEL } from '$lib/review/labels';
	import type { ReviewState } from '$lib/review/review-state.svelte';
	import type { SurfaceFile } from '$lib/review/surface';

	interface Props {
		file: SurfaceFile;
		view: ReviewState;
	}

	let { file, view }: Props = $props();

	const diff = $derived(view.files.find((item) => item.path === file.path));

	const lines = $derived(
		diff
			? fileLines(
					diff,
					(view.surface?.decisions ?? []).filter((decision) => decision.file === file.path)
				)
			: []
	);
</script>

<article class="detail detail-file" aria-label={file.path}>
	<header class="detail-head">
		<div class="detail-kicker">
			<span class="att-chip" data-cls={file.cls}>{CLASS_LABEL[file.cls]}</span>
			{#if !file.examined}<span class="detail-kicker-text">No reviewer opened this file</span>{/if}
			<span class="detail-kicker-text mono tabular"
				><span class="text-ok">+{file.additions}</span> <span class="text-sev-high">−{file.deletions}</span></span
			>
		</div>
	</header>
	{#if diff}
		<CodeView path={file.path} {lines} class="code-full" />
	{/if}
</article>
