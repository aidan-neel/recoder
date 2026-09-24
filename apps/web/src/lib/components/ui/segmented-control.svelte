<script lang="ts">
	import * as Tabs from '@sivir-ui/svelte/components/tabs';

	interface Item {
		value: string;
		label: string;
		disabled?: boolean;
	}

	interface Props {
		items: Item[];
		value?: string;
		onValueChange?: (value: string) => void;
		label: string;
		class?: string;
	}

	/** Session-header segmented control: Sivir Tabs (segmented), thumb slides over 200ms. */
	let { items, value = $bindable(''), onValueChange, label, class: className = '' }: Props = $props();
</script>

<Tabs.Root bind:value {onValueChange} variant="segmented" class={className}>
	<Tabs.List {...{ 'aria-label': label }}>
		{#each items as item (item.value)}
			<Tabs.Trigger value={item.value} disabled={item.disabled}>{item.label}</Tabs.Trigger>
		{/each}
	</Tabs.List>
</Tabs.Root>
