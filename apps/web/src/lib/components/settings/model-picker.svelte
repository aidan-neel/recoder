<script lang="ts">
	import { onMount } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import * as DropdownMenu from '@sivir-ui/svelte/components/dropdown-menu';
	import type { ReasoningEffort } from '@recoder/shared';
	import {
		effortLabel,
		formatContextWindow,
		modelSettingsUi,
		resolveEffort,
		type ModelChoice,
		type ModelOption
	} from '$lib/settings/model-settings.svelte';

	interface Props {
		/** Current selection; null while settings load or when nothing is configured. */
		value: ModelChoice | null;
		onSelect: (choice: ModelChoice) => void;
		/** 30px in composers, 28px in side panels. */
		size?: 'md' | 'panel';
		/** Trigger text when `value` is null (e.g. "Same as Review"). */
		placeholder?: string;
		/** Offers `placeholder` as the first model option, to go back to following another pick. */
		onFollow?: () => void;
		disabled?: boolean;
		label?: string;
	}

	let {
		value,
		onSelect,
		size = 'md',
		placeholder = 'Choose a model',
		onFollow,
		disabled = false,
		label = 'Model and reasoning effort'
	}: Props = $props();

	let open = $state(false);
	let triggerEl: HTMLElement | undefined;

	/**
	 * Right-align the menu to the trigger. Sivir's dropdown is always "-start"
	 * and Floating UI may already have shifted it to fit the viewport, so
	 * measure after it opens and nudge by the actual gap (kept on screen).
	 */
	$effect(() => {
		if (!open || !triggerEl) return;

		const trigger = triggerEl;

		const frame = requestAnimationFrame(() => {
			const panel = [...document.querySelectorAll<HTMLElement>("[data-ui='popover-content'].model-menu")].at(-1);
			const floating = panel?.closest<HTMLElement>('[data-floating-content]');

			if (!panel || !floating) return;

			const current = parseFloat(floating.style.getPropertyValue('--menu-shift')) || 0;
			const rect = panel.getBoundingClientRect();
			const wanted = current + trigger.getBoundingClientRect().right - rect.right;
			const minShift = current + 8 - rect.left;

			floating.style.setProperty('--menu-shift', `${Math.max(wanted, minShift)}px`);
		});

		return () => cancelAnimationFrame(frame);
	});

	onMount(() => {
		if (!modelSettingsUi.config && !modelSettingsUi.loading) void modelSettingsUi.load();
	});

	const models = $derived(modelSettingsUi.models);
	/** Models by agent, then by provider; both A to Z. */
	const agents = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local Map in $derived.by, not reactive state
		const byAgent = new Map<string, ModelOption[]>();

		for (const option of models) byAgent.set(option.agent, [...(byAgent.get(option.agent) ?? []), option]);

		return [...byAgent.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([agent, options]) => ({ agent, groups: byProvider(options) }));
	});
	const model = $derived<ModelOption | undefined>(models.find((item) => item.id === value?.modelId));
	const effort = $derived(resolveEffort(model, value?.effort));
	const triggerKey = $derived(`${model?.id ?? ''}:${effort ?? ''}`);

	/** The label only animates when the developer changes it, never when it first loads. */
	let picked = $state(false);

	/** Options by provider, providers A to Z. */
	function byProvider(options: ModelOption[]): [string, ModelOption[]][] {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local Map, not reactive state
		const groups = new Map<string, ModelOption[]>();

		for (const option of options) groups.set(option.provider, [...(groups.get(option.provider) ?? []), option]);

		return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
	}

	/** Switching to a model that lacks the current effort resets to its default. */
	function pickModel(next: ModelOption): void {
		picked = true;
		onSelect({ modelId: next.id, effort: resolveEffort(next, effort) });
	}

	function pickEffort(next: ReasoningEffort): void {
		picked = true;
		if (model) onSelect({ modelId: model.id, effort: next });
	}
</script>

<DropdownMenu.Root bind:open>
	<DropdownMenu.Trigger
		variant="quiet"
		class="quiet-trigger"
		data-size={size}
		{@attach (node: HTMLElement) => {
			triggerEl = node;
		}}
		disabled={disabled || models.length === 0}
		aria-label="{label}: {model ? `${model.displayName}${effort ? ` ${effortLabel(effort)}` : ''}` : placeholder}"
	>
		{#key triggerKey}
			<span class="quiet-trigger-label" data-picked={picked || undefined}>
				{#if model}
					{model.displayName}
					{#if effort}<span class="text-fg-subtle">{effortLabel(effort)}</span>{/if}
				{:else}
					<span class="text-fg-subtle">{placeholder}</span>
				{/if}
			</span>
		{/key}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content class="model-menu">
		<DropdownMenu.Sub>
			<DropdownMenu.SubTrigger class="model-menu-row">
				<span class="flex w-full items-center gap-2">
					<span class="flex-1">Model</span>
					<span class="model-menu-value">{model?.displayName ?? (onFollow ? placeholder : 'None')}</span>
				</span>
			</DropdownMenu.SubTrigger>
			<DropdownMenu.SubContent class="submenu-left model-menu-models w-[250px]">
				{#if onFollow}
					<DropdownMenu.Item callback={onFollow} class="model-option" aria-checked={!value} role="menuitemradio">
						<span class="flex w-3 shrink-0 justify-center" aria-hidden="true"
							>{#if !value}<Check size={12} />{/if}</span
						>
						<span class="flex-1 truncate text-left text-[13px]">{placeholder}</span>
					</DropdownMenu.Item>
					<DropdownMenu.Separator />
				{/if}
				{#if agents.length > 1}
					{#each agents as { agent, groups } (agent)}
						<DropdownMenu.Sub>
							<DropdownMenu.SubTrigger class="model-menu-row">
								<span class="flex w-full items-center gap-2">
									<span class="flex w-3 shrink-0 justify-center" aria-hidden="true"
										>{#if model?.agent === agent}<Check size={12} />{/if}</span
									>
									<span class="min-w-0 flex-1 truncate">{agent}</span>
								</span>
							</DropdownMenu.SubTrigger>
							<DropdownMenu.SubContent class="submenu-left model-menu-models w-[250px]">
								{@render providerGroups(groups)}
							</DropdownMenu.SubContent>
						</DropdownMenu.Sub>
					{/each}
				{:else}
					{@render providerGroups(agents[0]?.groups ?? [])}
				{/if}
			</DropdownMenu.SubContent>
		</DropdownMenu.Sub>

		{#if model?.efforts}
			<DropdownMenu.Sub>
				<DropdownMenu.SubTrigger class="model-menu-row">
					<span class="flex w-full items-center gap-2">
						<span class="flex-1">Reasoning effort</span>
						<span class="model-menu-value">{effort ? effortLabel(effort) : ''}</span>
					</span>
				</DropdownMenu.SubTrigger>
				<DropdownMenu.SubContent class="submenu-left w-[250px]">
					{#each model.efforts as option (option.id)}
						<DropdownMenu.Item
							callback={() => pickEffort(option.id)}
							class="model-option"
							aria-checked={option.id === effort}
							role="menuitemradio"
						>
							<span class="flex w-3 shrink-0 justify-center self-start pt-0.5" aria-hidden="true">
								{#if option.id === effort}<Check size={12} />{/if}
							</span>
							<span class="flex min-w-0 flex-1 flex-col gap-px text-left">
								<span class="text-[13px]">{option.label}</span>
								<span class="text-[11.5px] text-fg-faint">{option.description}</span>
							</span>
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.SubContent>
			</DropdownMenu.Sub>
		{:else if model}
			<DropdownMenu.Item disabled class="model-menu-row">
				<span class="flex-1 text-left">Reasoning effort</span>
				<span class="model-menu-value">Not supported</span>
			</DropdownMenu.Item>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>

{#snippet providerGroups(groups: [string, ModelOption[]][])}
	{#if groups.length > 1}
		{#each groups as [provider, options] (provider)}
			<DropdownMenu.Sub>
				<DropdownMenu.SubTrigger class="model-menu-row">
					<span class="flex w-full items-center gap-2">
						<span class="flex w-3 shrink-0 justify-center" aria-hidden="true"
							>{#if model?.provider === provider}<Check size={12} />{/if}</span
						>
						<span class="min-w-0 flex-1 truncate">{provider}</span>
						<span class="model-menu-value">{options.length}</span>
					</span>
				</DropdownMenu.SubTrigger>
				<DropdownMenu.SubContent class="submenu-left model-menu-models w-[270px]">
					{#each options as option (option.id)}
						{@render modelItem(option, false)}
					{/each}
				</DropdownMenu.SubContent>
			</DropdownMenu.Sub>
		{/each}
	{:else}
		{#each groups[0]?.[1] ?? [] as option (option.id)}
			{@render modelItem(option, true)}
		{/each}
	{/if}
{/snippet}

{#snippet modelItem(option: ModelOption, showProvider: boolean)}
	<DropdownMenu.Item
		callback={() => pickModel(option)}
		class="model-option"
		aria-checked={option.id === model?.id}
		role="menuitemradio"
	>
		<span class="flex w-3 shrink-0 justify-center" aria-hidden="true">
			{#if option.id === model?.id}<Check size={12} />{/if}
		</span>
		<span class="flex min-w-0 flex-1 flex-col gap-px text-left">
			<span class="truncate text-[13px]">{option.displayName}</span>
			{#if showProvider || option.contextWindow}
				<span class="truncate text-[11px] text-fg-faint"
					>{[
						showProvider ? option.provider : null,
						option.contextWindow ? `${formatContextWindow(option.contextWindow)} context` : null
					]
						.filter(Boolean)
						.join(' · ')}</span
				>
			{/if}
		</span>
	</DropdownMenu.Item>
{/snippet}
