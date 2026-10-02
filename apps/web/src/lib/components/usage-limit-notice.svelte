<script lang="ts">
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Gauge from '@lucide/svelte/icons/gauge';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as DropdownMenu from '@sivir-ui/svelte/components/dropdown-menu';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import type { ModelEntry, UsageLimit } from '@recoder/shared';
	import { modelSettingsUi, providerName, resolveEffort, toModelOption } from '$lib/model-settings.svelte';
	import { errorToast } from '$lib/notify';
	import { serverApi } from '$lib/server-api';
	import { shellState } from '$lib/shell-state.svelte';

	/**
	 * A model plan ran out. Says when it resets, and offers the way to keep
	 * going now: a model from another provider, then the same retry.
	 */
	interface Props {
		limit: UsageLimit;
		/** Continue what failed; runs after switching models too. */
		onRetry?: (() => void) | null;
		retrying?: boolean;
		class?: string;
	}
	let { limit, onRetry = null, retrying = false, class: className = '' }: Props = $props();

	/** `codex`, a hosted provider id, or `custom`: the same keys a UsageLimit uses. */
	function providerKey(entry: ModelEntry): string {
		return entry.provider === 'codex' ? 'codex' : (entry.source ?? 'custom');
	}

	/** Models on other providers, grouped by provider. */
	const alternatives = $derived.by(() => {
		const groups = new Map<string, ModelEntry[]>();

		for (const entry of modelSettingsUi.config?.models ?? []) {
			if (providerKey(entry) === limit.provider) continue;

			const name = providerName(entry);

			groups.set(name, [...(groups.get(name) ?? []), entry]);
		}

		return [...groups.entries()];
	});

	/* ── When it resets ──────────────────────────────────────── */

	let resetsAt = $state<number | null>(null);
	let now = $state(Date.now());

	$effect(() => {
		resetsAt = limit.resetsAt ?? null;
		if (limit.provider !== 'codex' || resetsAt) return;

		// ChatGPT reports its windows; the one that ran out decides when reviews can run again.
		let cancelled = false;

		void serverApi
			.getCodexStatus()
			.then((status) => {
				if (cancelled) return;

				const spent = (status.limits ?? []).filter((item) => item.usedPercent >= 100 && item.resetsAt);
				const next = spent.length ? Math.max(...spent.map((item) => item.resetsAt!)) : null;

				resetsAt = next;
			})
			.catch(() => {});

		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		if (!resetsAt) return;

		const timer = setInterval(() => (now = Date.now()), 30_000);

		return () => clearInterval(timer);
	});

	const resetText = $derived.by(() => {
		if (!resetsAt) return limit.usageUrl ? `Check your ${limit.name} plan for when it resets.` : null;

		const minutes = Math.ceil((resetsAt * 1000 - now) / 60_000);

		if (minutes <= 0) return 'It should have reset. Try again.';
		if (minutes < 60) return `Resets in ${minutes} min.`;

		const hours = Math.floor(minutes / 60);

		if (hours < 24) return `Resets in ${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''}.`;

		return `Resets ${new Date(resetsAt * 1000).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.`;
	});

	/* ── Switch ──────────────────────────────────────────────── */

	let switching = $state(false);

	/** Review moves to the new model; Specialists follow it when they were on the spent plan too. */
	async function switchTo(entry: ModelEntry): Promise<void> {
		const config = modelSettingsUi.config;

		if (!config || switching) return;
		switching = true;

		const specialist = config.models.find((item) => item.id === config.specialistModelId);

		const ok = await modelSettingsUi.update({
			orchestratorModelId: entry.id,
			orchestratorEffort: resolveEffort(toModelOption(entry), null),
			...(specialist && providerKey(specialist) === limit.provider
				? { specialistModelId: null, specialistEffort: null }
				: {})
		});

		switching = false;

		if (!ok) {
			errorToast('Could not switch models');

			return;
		}

		onRetry?.();
	}
</script>

<Card.Root class="review-notice usage-notice {className}" {...{ role: 'alert' }}>
	<Gauge size={15} class="review-notice-icon" aria-hidden="true" />
	<div class="min-w-0 flex-1">
		<p class="review-notice-title">{limit.name} is out of usage</p>
		<p class="review-notice-body">
			{#if resetText}{resetText}{' '}{/if}{alternatives.length
				? 'Switch to another model to keep going now.'
				: 'Connect another provider to keep going now.'}
		</p>
		<div class="usage-notice-actions">
			{#if alternatives.length}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger variant="outline" class="gap-1.5" disabled={switching || retrying}>
						Switch model
						{#if switching || retrying}<Spinner size={13} aria-hidden="true" />{:else}<ChevronDown
								size={13}
								aria-hidden="true"
							/>{/if}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content class="model-menu-models w-[260px]">
						{#each alternatives as [provider, entries], g (provider)}
							{#if g > 0}<DropdownMenu.Separator />{/if}
							<DropdownMenu.Label class="model-menu-group">{provider}</DropdownMenu.Label>
							{#each entries as entry (entry.id)}
								<DropdownMenu.Item callback={() => void switchTo(entry)} class="model-option">
									<span class="truncate text-[13px]">{toModelOption(entry).displayName}</span>
								</DropdownMenu.Item>
							{/each}
						{/each}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{:else}
				<Button variant="outline" onclick={() => modelSettingsUi.show('models')}>Add a provider</Button>
			{/if}
			{#if limit.provider === 'codex'}
				<Button variant="ghost" onclick={() => (shellState.usageOpen = true)}>View usage</Button>
			{:else if limit.usageUrl}
				<Button variant="ghost" href={limit.usageUrl} target="_blank" rel="noopener noreferrer" class="gap-1.5">
					Check usage <ArrowUpRight size={13} aria-hidden="true" />
				</Button>
			{/if}
			{#if onRetry}
				<Button variant="ghost" class="gap-1.5" disabled={retrying || switching} onclick={onRetry}>
					<RotateCcw size={13} aria-hidden="true" /> Retry
				</Button>
			{/if}
		</div>
	</div>
</Card.Root>
