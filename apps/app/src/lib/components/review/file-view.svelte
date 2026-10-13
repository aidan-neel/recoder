<script lang="ts">
	import * as FileDiff from '@sivir-ui/svelte/components/file-diff';
	import CodeView from './code-view.svelte';
	import StatusGlyph from '../ui/status-glyph.svelte';
	import { fileLines, type ExcerptLine } from '$lib/review/excerpt';
	import { CLASS_LABEL, decisionGlyph, plain, STATE_LABEL } from '$lib/review/labels';
	import type { ReviewState } from '$lib/review/review-state.svelte';
	import type { SurfaceFile } from '$lib/review/surface';

	interface Props {
		file: SurfaceFile;
		view: ReviewState;
	}

	let { file, view }: Props = $props();

	const diff = $derived(view.files.find((item) => item.path === file.path));

	const decisions = $derived((view.surface?.decisions ?? []).filter((decision) => decision.file === file.path));
	const lines = $derived(
		diff
			? fileLines(
					diff,
					decisions.filter((decision) => view.decisions.stateOf(decision.id) === 'open')
				)
			: []
	);

	/** Decisions whose range ends on this line, shown as a row right under it. */
	const endingAt = (item: ExcerptLine) =>
		item.line.type === 'del'
			? []
			: decisions.filter((decision) => (decision.endLine ?? decision.line) === item.line.newNo);
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
		<CodeView path={file.path} {lines} class="code-full">
			{#snippet annotate(item: ExcerptLine)}
				{#each endingAt(item) as decision (decision.id)}
					{@const state = view.decisions.stateOf(decision.id)}
					<FileDiff.Row class="code-note-row">
						<button
							class="code-note"
							type="button"
							data-state={state}
							onclick={() => view.select({ kind: 'decision', id: decision.id })}
						>
							<StatusGlyph kind={decisionGlyph(decision, state)} />
							<span class="code-note-title">{plain(decision.title)}</span>
							<span class="code-note-state">{STATE_LABEL[state]}</span>
						</button>
					</FileDiff.Row>
				{/each}
			{/snippet}
		</CodeView>
	{/if}
</article>
