<script lang="ts">
	import FileIcon from '@lucide/svelte/icons/file';
	import { Checkbox } from '@sivir-ui/svelte/components/checkbox';
	import * as Tabs from '@sivir-ui/svelte/components/tabs';
	import type { FileDiff } from '$lib/diff';
	import { diffPrefs } from '$lib/diff-prefs.svelte';

	let { diff }: { diff: FileDiff } = $props();
	const slash = $derived(diff.path.lastIndexOf('/'));
</script>

<header class="diff-file-header">
	<FileIcon size={14} class="shrink-0 text-fg-faint" aria-hidden="true" />
	<span class="diff-file-path" title={diff.path}>
		{#if slash >= 0}<span class="diff-file-dir">{diff.path.slice(0, slash + 1)}</span>{/if}<span class="diff-file-name">{diff.path.slice(slash + 1)}</span>
	</span>
	<span class="diff-file-stats"><span class="text-success">+{diff.additions}</span><span class="text-danger">−{diff.deletions}</span></span>
	<span class="ms-auto"></span>
	<Checkbox class="diff-viewed" label="Viewed" checked={diffPrefs.isViewed(diff.path)} onCheckedChange={(checked: boolean) => diffPrefs.setViewed(diff.path, checked)} />
	<Tabs.Root value={diffPrefs.mode} onValueChange={(value) => diffPrefs.setMode(value as 'unified' | 'split')} variant="segmented" class="view-switch diff-mode-switch">
		<Tabs.List {...{ 'aria-label': 'Diff layout' }}>
			<Tabs.Trigger value="unified">Unified</Tabs.Trigger>
			<Tabs.Trigger value="split">Split</Tabs.Trigger>
		</Tabs.List>
	</Tabs.Root>
</header>
