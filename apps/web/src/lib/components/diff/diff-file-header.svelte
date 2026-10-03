<script lang="ts">
	import FileIcon from '@lucide/svelte/icons/file';
	import { Checkbox } from '@sivir-ui/svelte/components/checkbox';
	import type { FileDiff } from '$lib/diff/diff';
	import { diffPrefs } from '$lib/diff/diff-prefs.svelte';
	import DiffModeSwitch from './diff-mode-switch.svelte';

	let { diff }: { diff: FileDiff } = $props();
	const slash = $derived(diff.path.lastIndexOf('/'));
</script>

<header class="diff-file-header">
	<FileIcon size={14} class="shrink-0 text-fg-faint" aria-hidden="true" />
	<span class="diff-file-path" title={diff.path}>
		{#if slash >= 0}<span class="diff-file-dir">{diff.path.slice(0, slash + 1)}</span>{/if}<span class="diff-file-name"
			>{diff.path.slice(slash + 1)}</span
		>
	</span>
	<span class="diff-file-stats"
		><span class="text-success">+{diff.additions}</span><span class="text-danger">−{diff.deletions}</span></span
	>
	<span class="ms-auto"></span>
	<Checkbox
		class="diff-viewed"
		label="Full file"
		checked={diffPrefs.fullFile}
		onCheckedChange={(checked: boolean) => diffPrefs.setFullFile(checked)}
	/>
	<Checkbox
		class="diff-viewed"
		label="Viewed"
		checked={diffPrefs.isViewed(diff.path)}
		onCheckedChange={(checked: boolean) => diffPrefs.setViewed(diff.path, checked)}
	/>
	<DiffModeSwitch />
</header>
