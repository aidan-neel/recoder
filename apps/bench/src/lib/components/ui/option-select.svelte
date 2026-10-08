<script lang="ts">
	import * as Select from '@sivir-ui/svelte/components/select';

	/** A choice; `color` adds a series dot, `detail` a faint note. */
	interface Option {
		value: string;
		label: string;
		detail?: string;
		color?: string;
	}

	let {
		value = $bindable(),
		options,
		label,
		class: className = '',
		onValueChange
	}: {
		value: string;
		options: Option[];
		/** Names the control for screen readers. */
		label: string;
		class?: string;
		onValueChange?: (value: string) => void;
	} = $props();

	/** The trigger names the choice itself, since the menu's labels only register once it opens. */
	const current = $derived(options.find((option) => option.value === value));
</script>

<Select.Root bind:value {onValueChange}>
	<Select.Trigger class="justify-between {className}" aria-label={label}>
		<span class="flex min-w-0 items-center gap-2">
			{#if current?.color}<span class="chart-swatch" data-shape="dot" style:background-color={current.color}
				></span>{/if}
			<span class="truncate">{current?.label ?? label}</span>
		</span>
	</Select.Trigger>
	<Select.Content>
		{#each options as option (option.value)}
			<Select.Item value={option.value} label={option.label}>
				<span class="flex min-w-0 items-center gap-2">
					{#if option.color}<span class="chart-swatch" data-shape="dot" style:background-color={option.color}
						></span>{/if}
					<span class="truncate">{option.label}</span>
					{#if option.detail}<span class="truncate font-mono text-[11px] text-fg-faint">{option.detail}</span>{/if}
				</span>
			</Select.Item>
		{/each}
	</Select.Content>
</Select.Root>
