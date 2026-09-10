<script lang="ts">
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import { Button } from '@sivir-ui/svelte/components/button';
	import type { ReviewMetrics, TokenAggregate, TokenUsage } from '@recoder/shared';
	import { serverApi } from '$lib/server-api';

	let { reviewId }: { reviewId: string } = $props();
	let open = $state(false);
	let metrics = $state<ReviewMetrics | null>(null);
	let loading = $state(true);
	let error = $state('');
	let retry = $state(0);
	const formatter = new Intl.NumberFormat();
	const primary = [
		{ key: 'inputTokens', label: 'Input' },
		{ key: 'outputTokens', label: 'Output' },
		{ key: 'totalTokens', label: 'Total' }
	] as const;
	const details = [
		{ key: 'cachedInputTokens', label: 'Cached input' },
		{ key: 'cacheWriteInputTokens', label: 'Cache writes' },
		{ key: 'reasoningOutputTokens', label: 'Reasoning output' }
	] as const;
	const scopeLabels = { pipeline: 'Review pipeline', discussion: 'Discussions', fix: 'Fix suggestions' };

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
		return () => { controller.abort(); if (timer) clearTimeout(timer); };
	});
</script>

{#snippet count(aggregate: TokenAggregate, key: keyof TokenUsage)}
	<span class="tabular-nums">{aggregate.usage[key] === null ? 'Unavailable' : formatter.format(aggregate.usage[key])}</span>
	{#if aggregate.reportedCalls[key] > 0 && aggregate.reportedCalls[key] < aggregate.calls}
		<span class="block text-xs font-normal text-foreground-muted">{aggregate.reportedCalls[key]}/{aggregate.calls} calls reported</span>
	{/if}
{/snippet}

{#snippet counts(aggregate: TokenAggregate, breakdown = false)}
	<dl class="grid gap-3 text-sm sm:grid-cols-3">
		{#each primary as field}
			<div class="min-w-0">
				<dt class="text-foreground-muted">{field.label}</dt>
				<dd class="mt-1 break-words font-medium">{@render count(aggregate, field.key)}</dd>
			</div>
		{/each}
	</dl>
	{#if breakdown}
		<dl class="mt-3 grid gap-1 text-xs text-foreground-muted">
			{#each details as field}
				{#if aggregate.usage[field.key] !== null}
					<div class="flex justify-between gap-4">
						<dt>{field.label}</dt><dd class="text-right">{@render count(aggregate, field.key)}</dd>
					</div>
				{/if}
			{/each}
		</dl>
	{/if}
{/snippet}

<Modal.Root bind:open>
	<Modal.Trigger variant="ghost" size="sm" class="shrink-0 font-sans">Token usage</Modal.Trigger>
	<Modal.Content size="md" surfaceClass="max-h-[min(75dvh,42rem)] overflow-y-auto overscroll-contain">
		<Modal.Header>
			<Modal.Title>Review token usage</Modal.Title>
			<Modal.Description>Review pipeline, discussions, and fix suggestions for this review, including retries.</Modal.Description>
		</Modal.Header>
		<Modal.Body class="gap-5">
			<p role="status" class={loading ? 'text-sm text-foreground-muted' : 'sr-only'}>{loading ? 'Loading token usage...' : ''}</p>
			{#if error}
				<div role="alert" class="text-sm">
					<p>Could not refresh token usage: {error}{metrics ? ' Showing the last loaded counts.' : ''}</p>
					<Button variant="outline" size="sm" class="mt-2" onclick={() => retry++}>Retry</Button>
				</div>
			{/if}
			{#if !loading && !error && !metrics}
				<p class="text-sm text-foreground-muted">Token usage was not recorded for this review. Historical counts cannot be recovered.</p>
			{:else if metrics}
				{#if !metrics.pipelineTracked}
					<p class="text-sm text-foreground-muted">Partial history: recording started with a follow-up. Earlier pipeline and follow-up usage is unavailable.</p>
				{/if}
				<section aria-label="Reported totals">
					<h3 class="mb-3 text-sm font-semibold">Reported totals <span class="font-normal text-foreground-muted">({metrics.total.calls} requests)</span></h3>
					{@render counts(metrics.total, true)}
				</section>
				{#if metrics.total.calls === 0}
					<p class="text-sm text-foreground-muted">No model requests recorded yet.</p>
				{/if}
				{#if metrics.total.pendingCalls || metrics.total.failedCalls}
					<p class="text-xs text-foreground-muted">{metrics.total.pendingCalls} unfinished requests; {metrics.total.failedCalls} failed requests. Any reported tokens are included.</p>
				{/if}
				{#if metrics.models.length}
					<section aria-label="Usage by model" class="grid gap-4 border-t border-border pt-4">
						<h3 class="text-sm font-semibold">By model</h3>
						{#each metrics.models as model (`${model.provider}:${model.model}`)}
							<div>
								<p class="break-words text-sm font-medium">{model.model}</p>
								<p class="mb-2 text-xs text-foreground-muted">{model.provider === 'codex' ? 'Codex' : 'OpenAI-compatible'} / {model.calls} requests</p>
								{@render counts(model, true)}
							</div>
						{/each}
					</section>
					<details class="border-t border-border pt-4">
						<summary class="cursor-pointer text-sm font-medium">By activity</summary>
						<div class="mt-3 grid gap-4">
							{#each metrics.scopes.filter((scope) => scope.calls > 0) as scope (scope.scope)}
								<section aria-label={scopeLabels[scope.scope]}>
									<h4 class="mb-2 text-sm">{scopeLabels[scope.scope]} <span class="text-foreground-muted">({scope.calls} requests)</span></h4>
									{@render counts(scope, true)}
								</section>
							{/each}
						</div>
					</details>
				{/if}
				<p class="text-xs leading-relaxed text-foreground-muted">Provider-reported tokens, not a billing estimate. Missing counts are unavailable, not zero. Partial sums include only reporting calls. Cache and reasoning breakdowns are shown when provided and are not added again to totals. Models are grouped by requested model and provider. Each Codex request is one turn and includes its reported internal model usage. Updates every few seconds while open.</p>
			{/if}
		</Modal.Body>
		<Modal.Footer><Modal.Close>Close</Modal.Close></Modal.Footer>
	</Modal.Content>
</Modal.Root>
