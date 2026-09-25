<script lang="ts">
	import * as Alert from '@sivir-ui/svelte/components/alert';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import { Progress } from '@sivir-ui/svelte/components/progress';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import type { ReviewMetrics, TokenAggregate } from '@recoder/shared';
	import UsageSkeleton from './usage-skeleton.svelte';
	import { serverApi } from '$lib/server-api';
	import { modelLabel } from '$lib/model-settings.svelte';

	let { reviewId, open = $bindable(false), showTrigger = true }: { reviewId: string; open?: boolean; showTrigger?: boolean } = $props();
	let metrics = $state<ReviewMetrics | null>(null);
	let loading = $state(true);
	let error = $state('');
	let retry = $state(0);
	const formatter = new Intl.NumberFormat();

	$effect(() => {
		if (!open) return;
		const id = reviewId;
		void retry;
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		metrics = null;
		loading = true;
		error = '';
		async function refresh() {
			try {
				const result = await serverApi.getReviewMetrics(id, controller.signal);
				if (controller.signal.aborted) return;
				metrics = result;
				error = '';
			} catch (cause) {
				if (controller.signal.aborted) return;
				error = cause instanceof Error ? cause.message : 'Could not load token usage.';
			} finally {
				if (!controller.signal.aborted) {
					loading = false;
					timer = setTimeout(refresh, 2500);
				}
			}
		}
		void refresh();
		return () => {
			controller.abort();
			if (timer) clearTimeout(timer);
		};
	});

	const plural = (n: number, word: string) => `${formatter.format(n)} ${word}${n === 1 ? '' : 's'}`;
	const tokens = (n: number | null) => (n === null ? '—' : formatter.format(n));
	/** Total, or input + output when the provider reports no total. */
	function totalOf(aggregate: TokenAggregate): number | null {
		const { totalTokens, inputTokens, outputTokens } = aggregate.usage;
		if (totalTokens !== null) return totalTokens;
		return inputTokens === null && outputTokens === null ? null : (inputTokens ?? 0) + (outputTokens ?? 0);
	}
	/** "12,340 in · 3,210 out · 1,200 cached · 4 requests". */
	function breakdown(aggregate: TokenAggregate, requests = true): string {
		const { inputTokens, outputTokens, cachedInputTokens, cacheWriteInputTokens, reasoningOutputTokens } = aggregate.usage;
		return [
			inputTokens !== null && `${formatter.format(inputTokens)} in`,
			outputTokens !== null && `${formatter.format(outputTokens)} out`,
			reasoningOutputTokens && `${formatter.format(reasoningOutputTokens)} reasoning`,
			cachedInputTokens && `${formatter.format(cachedInputTokens)} cached`,
			cacheWriteInputTokens && `${formatter.format(cacheWriteInputTokens)} cache writes`,
			requests && plural(aggregate.calls, 'request')
		].filter(Boolean).join(' · ');
	}
	/** Calls whose provider left some counts out, e.g. "3 reported tokens". */
	function coverageNote(aggregate: TokenAggregate): string | null {
		const reported = aggregate.reportedCalls.totalTokens || Math.max(aggregate.reportedCalls.inputTokens, aggregate.reportedCalls.outputTokens);
		return reported > 0 && reported < aggregate.calls ? `${reported} reported tokens` : null;
	}

	const grandTotal = $derived(metrics ? totalOf(metrics.total) : null);
	const models = $derived(
		(metrics?.models ?? [])
			.map((model) => ({ ...model, tokens: totalOf(model) }))
			.sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0))
	);
</script>

<Modal.Root bind:open>
	{#if showTrigger}<Modal.Trigger variant="ghost" class="shrink-0 font-sans">Usage</Modal.Trigger>{/if}
	<Modal.Content size="md" class="usage-modal" aria-label="Review token usage">
		<Modal.Header>
			<Modal.Title>Token usage</Modal.Title>
		</Modal.Header>
		<Modal.Body class="gap-5">
			{#if error}
				<Alert.Root variant="error">
					<Alert.Title>Could not refresh token usage</Alert.Title>
					<Alert.Description>{error}{metrics ? ' Showing the last loaded counts.' : ''}</Alert.Description>
					<Button variant="outline" class="mt-2 self-start" onclick={() => retry++}>Retry</Button>
				</Alert.Root>
			{/if}
			{#if loading && !metrics}
				<UsageSkeleton label="Loading token usage" detail />
			{:else if !metrics}
				{#if !error}<Typography.Text variant="supporting">Token usage wasn't recorded for this review, and earlier counts can't be recovered.</Typography.Text>{/if}
			{:else}
				<div class="flex flex-col gap-1">
					<Typography.Text class="usage-account">
						<span class="text-fg">{tokens(grandTotal)} tokens</span><span class="mx-1.5 text-fg-faint" aria-hidden="true">·</span>{plural(metrics.total.calls, 'request')}
					</Typography.Text>
					{#if metrics.total.calls > 0}<span class="text-[12px] text-fg-faint">{breakdown(metrics.total, false)}</span>{/if}
				</div>
				<div class="flex flex-col gap-4">
					{#each models as model (`${model.provider}:${model.model}`)}
						{@const share = grandTotal && model.tokens !== null ? Math.round((model.tokens / grandTotal) * 100) : null}
						{@const note = coverageNote(model)}
						<div class="flex flex-col gap-2">
							<div class="flex items-baseline justify-between gap-3">
								<span class="min-w-0 truncate text-[12.5px] text-fg" title={model.model}>{modelLabel(model.model)}<span class="ms-2 font-sans text-[12px] text-fg-faint">{model.provider === 'codex' ? 'ChatGPT' : 'Endpoint'}</span></span>
								<span class="shrink-0 font-mono text-[12.5px] text-fg-muted tabular-nums">{tokens(model.tokens)}</span>
							</div>
							{#if share !== null}
								<Progress value={share} class="usage-bar" {...{ 'aria-label': `${model.model} share of tokens, ${share}%` }} />
							{/if}
							<span class="text-[12px] text-fg-faint">{breakdown(model)}{note ? ` · ${note}` : ''}</span>
						</div>
					{:else}
						<Typography.Text variant="supporting">No model requests recorded yet.</Typography.Text>
					{/each}
				</div>
				{#if !metrics.pipelineTracked || metrics.total.pendingCalls || metrics.total.failedCalls}
					<span class="text-[12px] text-fg-faint">
						{#if !metrics.pipelineTracked}Recording started with a follow-up, so the original review isn't counted.{/if}
						{#if metrics.total.pendingCalls || metrics.total.failedCalls}
							{[metrics.total.pendingCalls && `${plural(metrics.total.pendingCalls, 'request')} still running`, metrics.total.failedCalls && `${plural(metrics.total.failedCalls, 'request')} failed`].filter(Boolean).join(', ')}; their reported tokens are included.
						{/if}
					</span>
				{/if}
			{/if}
		</Modal.Body>
		<Modal.Footer>
			<Modal.Close variant="primary" class="ml-auto mr-0">Done</Modal.Close>
		</Modal.Footer>
	</Modal.Content>
</Modal.Root>
