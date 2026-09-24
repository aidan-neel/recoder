<script lang="ts">
	import { parseUnifiedDiff } from '@recoder/shared';
	import Maximize2 from '@lucide/svelte/icons/maximize-2';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import * as Tabs from '@sivir-ui/svelte/components/tabs';
	import CodeDiff from './code-diff.svelte';
	import type { FixSuggestion } from '$lib/findings.svelte';
	import { diffPrefs } from '$lib/diff-prefs.svelte';
	import { highlightLines } from '$lib/highlight';
	import { fileIconUrl } from '$lib/material-icons';

	let { suggestion }: { suggestion: FixSuggestion } = $props();
	let reviewOpen = $state(false);

	/** Changed lines only; file headers and hunk markers add noise at this size. */
	const lines = $derived((suggestion.patch ?? '').split('\n').filter((line) =>
		(line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---')));
	const highlighted = $derived(highlightLines(lines.map((line) => line.slice(1))));
	/** The whole patch as file diffs, for the full-screen review (same view as the Diff tab). */
	const files = $derived(parseUnifiedDiff(suggestion.patch ?? ''));
	const additions = $derived(files.reduce((sum, file) => sum + file.additions, 0));
	const deletions = $derived(files.reduce((sum, file) => sum + file.deletions, 0));
</script>

<figure class="suggested-fix" aria-label="Suggested fix">
	<figcaption class="suggested-fix-head">
		<span>Suggested fix</span>
		{#if suggestion.applies === true}<span class="text-success">· applies cleanly</span>
		{:else if suggestion.applies === false}<span class="text-sev-medium">· may not apply cleanly</span>{/if}
		{#if files.length}
			<Button variant="ghost" size="icon" class="suggested-fix-expand" aria-label="Review the fix full screen" title="Review full screen" onclick={() => (reviewOpen = true)}>
				<Maximize2 size={13} aria-hidden="true" />
			</Button>
		{/if}
	</figcaption>
	{#if suggestion.summary}<p class="suggested-fix-summary">{suggestion.summary}</p>{/if}
	<pre class="suggested-fix-code">{#each lines as line, i (i)}<span data-sign={line[0]}><span class="suggested-fix-sign" aria-hidden="true">{line[0]}</span>{#if line.length > 1}{@html highlighted[i]}{:else}{' '}{/if}</span>{/each}</pre>
</figure>

<Modal.Root bind:open={reviewOpen}>
	<Modal.Content size="xl" class="fix-review-modal" aria-label="Review suggested fix" surfaceClass="!p-0 !gap-0">
		<Modal.Header class="fix-review-head">
			<Modal.Title class="fix-review-title">Suggested fix</Modal.Title>
			<span class="fix-review-meta">
				{files.length} {files.length === 1 ? 'file' : 'files'}
				<span class="text-success">+{additions}</span><span class="text-danger">−{deletions}</span>
				{#if suggestion.applies === true}<span class="text-success">· applies cleanly</span>
				{:else if suggestion.applies === false}<span class="text-sev-medium">· may not apply cleanly</span>{/if}
			</span>
			<Tabs.Root value={diffPrefs.mode} onValueChange={(value) => diffPrefs.setMode(value as 'unified' | 'split')} variant="segmented" class="view-switch diff-mode-switch fix-review-mode">
				<Tabs.List {...{ 'aria-label': 'Diff layout' }}>
					<Tabs.Trigger value="unified">Unified</Tabs.Trigger>
					<Tabs.Trigger value="split">Split</Tabs.Trigger>
				</Tabs.List>
			</Tabs.Root>
		</Modal.Header>
		{#if suggestion.summary}<p class="fix-review-summary">{suggestion.summary}</p>{/if}
		<div class="fix-review-files">
			{#each files as file (file.path)}
				<section class="fix-review-file" aria-label={file.path}>
					<header class="fix-review-file-head">
						<img src={fileIconUrl(file.path.split('/').at(-1) ?? '')} alt="" width="14" height="14" />
						<span class="diff-file-path" title={file.path}><span class="diff-file-dir">{file.path.slice(0, file.path.lastIndexOf('/') + 1)}</span><span class="diff-file-name">{file.path.split('/').at(-1)}</span></span>
						<span class="fix-review-file-stats"><span class="text-success">+{file.additions}</span> <span class="text-danger">−{file.deletions}</span></span>
					</header>
					<CodeDiff diff={file} mode={diffPrefs.mode} cards={false} readonly />
				</section>
			{/each}
		</div>
	</Modal.Content>
</Modal.Root>
