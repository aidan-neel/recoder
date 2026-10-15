<script lang="ts">
	import CodeView from './code-view.svelte';
	import EvidenceBlock from './evidence-block.svelte';
	import RichText from '../ui/rich-text.svelte';
	import { excerpt } from '$lib/review/excerpt';
	import { where } from '$lib/review/labels';
	import type { ReviewState } from '$lib/review/review-state.svelte';
	import type { Receipt } from '$lib/review/surface';

	interface Props {
		receipt: Receipt;
		view: ReviewState;
	}

	let { receipt, view }: Props = $props();

	const diff = $derived(view.files.find((file) => file.path === receipt.file) ?? null);
	const code = $derived(diff ? excerpt(diff, receipt.line, receipt.line, 'new', 3) : null);
</script>

<article class="detail" aria-labelledby="detail-title">
	<header class="detail-head">
		<div class="detail-kicker">
			<span class="pill" data-tone="ok">{receipt.verdict === 'holds' ? 'Holds' : 'Not applicable'}</span>
			<span class="detail-kicker-text">Checked for you</span>
		</div>
		<h2 class="detail-title" id="detail-title"><RichText text={receipt.question} /></h2>
		<button class="detail-where mono" type="button" onclick={() => view.select({ kind: 'file', path: receipt.file })}>
			{where(receipt.file, receipt.line)}{#if receipt.symbol}<span class="detail-symbol">{receipt.symbol}</span>{/if}
		</button>
	</header>

	<p class="detail-body ai-voice"><RichText text={receipt.reason} /></p>

	{#if receipt.evidence}
		<section class="detail-section" aria-label="Evidence">
			<h3 class="detail-section-title">Evidence</h3>
			<EvidenceBlock evidence={receipt.evidence} />
		</section>
	{/if}

	{#if receipt.contract.length}
		<section class="detail-section" aria-label="Contract">
			<h3 class="detail-section-title">What it relied on</h3>
			<ul class="contract">
				{#each receipt.contract as item, index (index)}
					<li><span class="mono contract-where">{item.location}</span><span><RichText text={item.note} /></span></li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if code && diff}
		<section class="detail-section" aria-label="Code">
			<h3 class="detail-section-title">Code</h3>
			<CodeView path={receipt.file} lines={code.lines} above={code.above} below={code.below} />
		</section>
	{/if}
</article>
