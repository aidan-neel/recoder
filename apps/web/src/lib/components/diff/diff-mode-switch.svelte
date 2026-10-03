<script lang="ts">
	import * as Tabs from '@sivir-ui/svelte/components/tabs';
	import { diffPrefs } from '$lib/diff/diff-prefs.svelte';

	/** The Unified / Split layout switch shared by the diff header and the fix review. */
	let { class: className = '' }: { class?: string } = $props();
</script>

<Tabs.Root
	value={diffPrefs.mode}
	onValueChange={(value) => diffPrefs.setMode(value as 'unified' | 'split')}
	variant="segmented"
	class="view-switch diff-mode-switch {className}"
>
	<Tabs.List {...{ 'aria-label': 'Diff layout' }}>
		<Tabs.Trigger value="unified">Unified</Tabs.Trigger>
		<Tabs.Trigger value="split">Split</Tabs.Trigger>
	</Tabs.List>
</Tabs.Root>
