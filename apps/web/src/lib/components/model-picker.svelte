<script lang="ts">
	import { onMount } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import * as DropdownMenu from '@sivir-ui/svelte/components/dropdown-menu';
	import Shortcut from '@sivir-ui/svelte/components/shortcut';
	import type { ReasoningEffort } from '@recoder/shared';
	import {
		effortLabel,
		modelSettingsUi,
		resolveEffort,
		type ModelChoice,
		type ModelOption
	} from '$lib/model-settings.svelte';

	interface Props {
		/** Current selection; null while settings load or when nothing is configured. */
		value: ModelChoice | null;
		onSelect: (choice: ModelChoice) => void;
		/** 30px in composers, 28px in side panels. */
		size?: 'md' | 'panel';
		/** Composer extras: "Apply to all specialists" and "Role models…". */
		composerExtras?: boolean;
		/** Trigger text when `value` is null (e.g. "Same as Orchestrator"). */
		placeholder?: string;
		disabled?: boolean;
		label?: string;
	}

	let {
		value,
		onSelect,
		size = 'md',
		composerExtras = false,
		placeholder = 'Choose a model',
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
	const model = $derived<ModelOption | undefined>(models.find((item) => item.id === value?.modelId));
	const effort = $derived(resolveEffort(model, value?.effort));
	const triggerKey = $derived(`${model?.id ?? ''}:${effort ?? ''}`);

	function pickModel(next: ModelOption): void {
		// Switching to a model that lacks the current effort resets to its default.
		onSelect({ modelId: next.id, effort: resolveEffort(next, effort) });
	}

	function pickEffort(next: ReasoningEffort): void {
		if (model) onSelect({ modelId: model.id, effort: next });
	}

	function openRoleModels(): void {
		open = false;
		modelSettingsUi.show();
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
			<span class="quiet-trigger-label">
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
					<span class="model-menu-value">{model?.displayName ?? 'None'}</span>
				</span>
			</DropdownMenu.SubTrigger>
			<DropdownMenu.SubContent class="submenu-left w-[230px]">
				{#each models as option (option.id)}
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
							<span class="truncate text-[11px] text-fg-faint">{option.provider}</span>
						</span>
					</DropdownMenu.Item>
				{/each}
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
		{:else}
			<DropdownMenu.Item disabled class="model-menu-row">
				<span class="flex-1 text-left">Reasoning effort</span>
				<span class="model-menu-value">Not supported</span>
			</DropdownMenu.Item>
		{/if}

		{#if composerExtras}
			<DropdownMenu.Separator />
			<DropdownMenu.CheckboxItem
				class="model-menu-row apply-all"
				checked={modelSettingsUi.applyToSpecialists}
				onCheckedChange={(on) => void modelSettingsUi.setApplyToSpecialists(on)}
				onclick={(event) => event.preventDefault()}
			>
				<span class="flex-1 text-left text-fg-tertiary">Apply to all specialists</span>
				<span class="switch-sm" aria-hidden="true">
					<span data-ui="switch" data-state={modelSettingsUi.applyToSpecialists ? 'checked' : 'unchecked'} class="flex rounded-full"><span class="block rounded-full"></span></span>
				</span>
			</DropdownMenu.CheckboxItem>
			<DropdownMenu.Item callback={openRoleModels} class="model-menu-row text-fg-subtle">
				<span class="flex-1 text-left">Role models…</span>
				<Shortcut shortcut="cmd+," class="keycap" ontrigger={openRoleModels} />
			</DropdownMenu.Item>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>
