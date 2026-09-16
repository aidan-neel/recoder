<script lang="ts">
	import * as Alert from '@sivir-ui/svelte/components/alert';
	import { Badge } from '@sivir-ui/svelte/components/badge';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import type {
		ReviewMetrics,
		TokenAggregate,
		TokenUsage
	} from '@recoder/shared';
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
				error =
					cause instanceof Error
						? cause.message
						: 'Could not load token usage.';
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
</script>

{#snippet count(aggregate: TokenAggregate, key: keyof TokenUsage)}
	<span class="tabular-nums"
		>{aggregate.usage[key] === null
			? 'Unavailable'
			: formatter.format(aggregate.usage[key])}</span
	>
	{#if aggregate.reportedCalls[key] > 0 && aggregate.reportedCalls[key] < aggregate.calls}
		<Typography.Metadata class="block">
			{aggregate.reportedCalls[key]}/{aggregate.calls} calls reported
		</Typography.Metadata>
	{/if}
{/snippet}

{#snippet counts(aggregate: TokenAggregate, breakdown = false)}
	<div class="grid min-w-0 gap-3 text-sm sm:grid-cols-3">
		{#each primary as field}
			<div class="flex min-w-0 justify-between gap-3 sm:block">
				<Typography.Description class="m-0">{field.label}</Typography.Description>
				<div class="text-right font-medium sm:mt-1 sm:text-left">
					{@render count(aggregate, field.key)}
				</div>
			</div>
		{/each}
	</div>
	{#if breakdown}
		<div class="mt-3 grid gap-1">
			{#each details as field}
				{#if aggregate.usage[field.key] !== null}
					<div class="flex justify-between gap-4">
						<Typography.Metadata>{field.label}</Typography.Metadata>
						<Typography.Metadata class="text-right">
							{@render count(aggregate, field.key)}
						</Typography.Metadata>
					</div>
				{/if}
			{/each}
		</div>
	{/if}
{/snippet}

<Modal.Root bind:open>
	<Modal.Trigger variant="ghost" class="shrink-0 font-sans">Token usage</Modal.Trigger>
	<Modal.Content
		size="xl"
		surfaceClass="max-h-[min(75dvh,42rem)] overflow-y-auto overscroll-contain [overflow-wrap:anywhere]"
	>
		<Modal.Header>
			<Modal.Title>Review token usage</Modal.Title>
		</Modal.Header>
		<Modal.Body class="min-w-0 gap-5">
			<p role="status" class={loading ? 'text-sm text-foreground-muted' : 'sr-only'}>
				{loading ? 'Loading token usage...' : ''}
			</p>
			{#if error}
				<Alert.Root variant="error">
					<Alert.Title>Could not refresh token usage</Alert.Title>
					<Alert.Description>
						{error}{metrics ? ' Showing the last loaded counts.' : ''}
					</Alert.Description>
					<Button
						variant="outline"
						class="mt-2 self-start"
						onclick={() => retry++}>Retry</Button
					>
				</Alert.Root>
			{/if}
			{#if !loading && !error && !metrics}
				<Typography.Description>
					Token usage was not recorded for this review. Historical counts cannot
					be recovered.
				</Typography.Description>
			{:else if metrics}
				{#if !metrics.pipelineTracked}
					<Typography.Description>
						Partial history: recording started with a follow-up. Earlier pipeline
						and follow-up usage is unavailable.
					</Typography.Description>
				{/if}

				<Card.Root class="p-4">
					<Card.Header class="mb-3 flex-row items-baseline justify-between gap-2">
						<Typography.H3 class="m-0">Reported totals</Typography.H3>
						<Badge variant="outline">{metrics.total.calls} requests</Badge>
					</Card.Header>
					<Card.Content class="gap-3">
						{@render counts(metrics.total, true)}
						{#if metrics.total.calls === 0}
							<Typography.Description class="m-0">
								No model requests recorded yet.
							</Typography.Description>
						{/if}
						{#if metrics.total.pendingCalls || metrics.total.failedCalls}
							<Typography.Metadata>
								{metrics.total.pendingCalls} unfinished requests; {metrics.total
									.failedCalls} failed requests. Any reported tokens are included.
							</Typography.Metadata>
						{/if}
					</Card.Content>
				</Card.Root>

				{#if metrics.models.length}
					<Card.Root class="p-4">
						<Typography.H3 class="mb-3 mt-0">By model</Typography.H3>
						<div class="grid gap-4">
							{#each metrics.models as model (`${model.provider}:${model.model}`)}
								<div class="min-w-0">
									<div class="mb-2 flex flex-wrap items-center gap-2">
										<Typography.InlineCode class="text-sm"
											>{model.model}</Typography.InlineCode
										>
										<Badge variant="secondary"
											>{model.provider === 'codex'
												? 'Codex'
												: 'OpenAI-compatible'}</Badge
										>
										<Badge variant="outline">{model.calls} requests</Badge>
									</div>
									{@render counts(model, true)}
								</div>
							{/each}
						</div>
					</Card.Root>
				{/if}
			{/if}
		</Modal.Body>
		<Modal.Footer><Modal.Close>Close</Modal.Close></Modal.Footer>
	</Modal.Content>
</Modal.Root>
