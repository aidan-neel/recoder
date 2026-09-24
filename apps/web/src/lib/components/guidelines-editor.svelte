<script lang="ts">
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import X from '@lucide/svelte/icons/x';
	import * as Alert from '@sivir-ui/svelte/components/alert';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as DropdownMenu from '@sivir-ui/svelte/components/dropdown-menu';
	import * as FileDiff from '@sivir-ui/svelte/components/file-diff';
	import { Markdown } from '@sivir-ui/svelte/components/markdown';
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import * as Tabs from '@sivir-ui/svelte/components/tabs';
	import { Textarea } from '@sivir-ui/svelte/components/textarea';
	import { toast } from '@sivir-ui/svelte/components/toast';
	import ReviewComposer from './review-composer.svelte';
	import Skeleton from './ui/skeleton.svelte';
	import { guidelinesStore } from '$lib/guidelines.svelte';
	import { lineDiff } from '$lib/line-diff';
	import { keepPillAligned } from '$lib/tab-pill';
	import { errorToast, undoToast } from '$lib/notify';
	import { serverApi } from '$lib/server-api';

	/**
	 * The one editor for owner review guidelines (global layer or a repo's
	 * `.recoder/REVIEW.md`): one document column (Write / Preview), the
	 * composer docked below it for orchestrator drafts that land as a
	 * reviewable change, and Save (global) or Open pull request (repo) in the
	 * header. Mounted once in the layout.
	 */

	const editing = $derived(guidelinesStore.editing);
	const overview = $derived(guidelinesStore.overview);
	const repoState = $derived(editing?.kind === 'repo' ? guidelinesStore.repos[editing.repoId] : undefined);
	const repo = $derived(repoState?.status === 'ready' ? repoState.data : null);
	const max = $derived(overview?.maxChars ?? 8000);
	const ready = $derived(!!overview && (editing?.kind === 'global' || !!repo));
	const loadError = $derived(guidelinesStore.loadError ?? (repoState?.status === 'error' ? repoState.error : null));

	let text = $state('');
	let original = $state('');
	let seededFor = $state<string | null>(null);
	let pane = $state<'write' | 'preview'>('write');

	let prompt = $state('');
	/** Escape belongs to the sources menu while it is open, not the editor (see onKeyCapture). */
	let sourcesOpen = $state(false);
	let include = $state({ instructions: true, global: true });
	let drafting = $state(false);
	let draftError = $state<string | null>(null);
	/** A revision of existing text, shown as a diff until accepted or discarded. */
	let proposal = $state<string | null>(null);
	let abort: AbortController | null = null;

	let saving = $state(false);
	let saveError = $state<string | null>(null);

	const key = $derived(editing ? (editing.kind === 'global' ? 'global' : `repo:${editing.repoId}`) : null);
	const dirty = $derived(text !== original);
	const length = $derived(text.trim().length);
	const over = $derived(length > max);
	const hasRules = $derived(text.split('\n').some((line) => {
		const trimmed = line.trim();
		return trimmed && !trimmed.startsWith('#') && trimmed !== '-';
	}));
	/** Template placeholders (`-` with nothing after it) would render as empty bullets. */
	const previewText = $derived(text.replace(/^[ \t]*[-*][ \t]*$/gm, ''));

	// Seed once per open, when the source text is known.
	$effect(() => {
		if (!key || !ready || seededFor === key) return;
		const source = editing?.kind === 'global'
			? overview!.global.content
			: repo!.pending?.content ?? repo!.content ?? '';
		text = source || overview!.template;
		original = text;
		seededFor = key;
		pane = source.trim() ? 'preview' : 'write';
		prompt = '';
		proposal = null;
		draftError = null;
		saveError = null;
	});
	$effect(() => {
		if (!editing) {
			abort?.abort();
			seededFor = null;
		}
	});

	const title = $derived(editing?.kind === 'repo' ? guidelinesStore.repoName(editing.repoId) : 'Global guidelines');
	const primaryLabel = $derived(editing?.kind === 'global' ? 'Save' : repo?.pending ? 'Update pull request' : 'Open pull request');
	const blockedReason = $derived(editing?.kind === 'repo' && repo && !repo.canPropose
		? 'Connect a token with write access in Settings → Connections to open a pull request.'
		: null);

	/** One-click requests; the repo gets one that mines its instruction files. */
	const presets = $derived([
		{ label: 'Security first', prompt: 'Prioritize security, auth and data-loss issues and report them as errors.' },
		{ label: 'Skip style nits', prompt: 'Stop flagging naming, formatting and other style-only issues.' },
		{ label: 'Stricter severity', prompt: 'Be stricter about severity: only real bugs are errors; everything else is a warning or info.' },
		{ label: 'Require tests', prompt: 'Flag behavior changes that ship without tests.' },
		...(editing?.kind === 'repo'
			? [{ label: 'From repo instructions', prompt: 'Turn the rules in this repo’s instruction files (AGENTS.md, CLAUDE.md, CONTRIBUTING.md) into review guidelines.', instructions: true }]
			: [])
	]);

	const sourceCount = $derived(Number(include.instructions) + Number(include.global));

	async function draft(request: string): Promise<void> {
		if (drafting || !editing) return;
		drafting = true;
		draftError = null;
		const revising = hasRules;
		const before = text;
		abort = new AbortController();
		let streamed = '';
		if (revising) proposal = '';
		else {
			text = '';
			pane = 'preview';
		}
		try {
			const result = await serverApi.draftGuidelines({
				scope: editing.kind,
				repoId: editing.kind === 'repo' ? editing.repoId : undefined,
				prompt: request,
				current: revising ? before : undefined,
				include: editing.kind === 'repo' ? { ...include, findings: false } : { findings: false }
			}, (token) => {
				streamed += token;
				if (revising) proposal = streamed;
				else text = streamed;
			}, abort.signal);
			if (revising) proposal = result;
			else text = result;
			prompt = '';
		} catch (e) {
			if (revising) proposal = null;
			else text = before;
			// Keep the request so it can be retried or edited.
			if (!prompt) prompt = request;
			if (!(e instanceof DOMException && e.name === 'AbortError')) draftError = e instanceof Error ? e.message : 'The orchestrator did not respond.';
		} finally {
			drafting = false;
			abort = null;
		}
	}

	function acceptProposal(): void {
		if (proposal === null) return;
		text = proposal;
		proposal = null;
	}

	async function save(): Promise<void> {
		if (!editing || saving || over || proposal !== null || drafting || blockedReason) return;
		saving = true;
		saveError = null;
		try {
			if (editing.kind === 'global') {
				const previous = await guidelinesStore.saveGlobal(text);
				undoToast('Global guidelines saved', () => {
					void guidelinesStore.saveGlobal(previous).catch((e) => errorToast('Could not restore the guidelines', e instanceof Error ? e.message : undefined));
				});
			} else {
				const result = await guidelinesStore.propose(editing.repoId, text);
				toast.success(result.updated ? `Updated #${result.number}` : `Opened #${result.number}`, {
					description: 'Guidelines apply to pull requests opened after it merges.',
					duration: 6000,
					actions: [{ label: 'View', variant: 'ghost', callback: () => window.open(result.url, '_blank', 'noopener') }]
				});
			}
			guidelinesStore.close();
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Could not save.';
		} finally {
			saving = false;
		}
	}

	/**
	 * Stacked over Settings, this modal ties the sources menu on Sivir's Escape
	 * rank and wins, so the menu would never close. Close it first, before
	 * Sivir's document listener sees the key.
	 */
	function onKeyCapture(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || !sourcesOpen) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		sourcesOpen = false;
	}

	function onKey(event: KeyboardEvent): void {
		// The composer sends on Enter itself; ⌘↵ elsewhere saves.
		if (!editing || event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
		if (document.activeElement?.closest('.rc-composer')) return;
		event.preventDefault();
		event.stopPropagation();
		void save();
	}
</script>

<svelte:window onkeydown={onKey} onkeydowncapture={onKeyCapture} />

{#snippet sources()}
	<DropdownMenu.Root bind:open={sourcesOpen}>
		<DropdownMenu.Trigger variant="quiet" class="guidelines-sources gap-1" disabled={drafting}>
			{sourceCount === 0 ? 'No context' : `${sourceCount} ${sourceCount === 1 ? 'source' : 'sources'}`}<ChevronDown size={13} aria-hidden="true" />
		</DropdownMenu.Trigger>
		<DropdownMenu.Content>
			<DropdownMenu.CheckboxItem checked={include.instructions} onCheckedChange={(on) => (include.instructions = on)} onclick={(event) => event.preventDefault()}><span class="flex-1 text-left">Repo instruction files</span></DropdownMenu.CheckboxItem>
			<DropdownMenu.CheckboxItem checked={include.global} onCheckedChange={(on) => (include.global = on)} onclick={(event) => event.preventDefault()}><span class="flex-1 text-left">Global guidelines</span></DropdownMenu.CheckboxItem>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/snippet}

<Modal.Root bind:open={() => editing !== null, (open) => { if (!open) guidelinesStore.close(); }}>
	<Modal.Content
		size="xl"
		class="guidelines-modal"
		surfaceClass="!p-0 !gap-0"
		showClose={false}
		allowEscape={!saving && !drafting && !dirty && !sourcesOpen}
		allowClickOutside={false}
		aria-label={title}
	>
		<header class="guidelines-head">
			<Modal.Title class="guidelines-title">{title}</Modal.Title>
			<p class="guidelines-meta">
				{#if repo}
					<span title="Reviewers read this file from each pull request’s base branch">{repo.path} · {repo.content !== null ? `${repo.ref} ${repo.sha?.slice(0, 7) ?? ''}` : `not on ${repo.ref} yet`}</span>
					{#if repo.pending}<a class="guidelines-pending" href={repo.pending.url} target="_blank" rel="noopener">Pending in #{repo.pending.number} <ArrowUpRight size={12} aria-hidden="true" /></a>{/if}
				{/if}
				{#if ready}<span class="guidelines-count" data-over={over || undefined}>{length.toLocaleString()} / {max.toLocaleString()}</span>{/if}
			</p>
			{#if ready && proposal === null}
				<Tabs.Root value={pane} onValueChange={(value) => (pane = value as 'write' | 'preview')} variant="segmented" class="view-switch">
					<Tabs.List {...{ 'aria-label': 'Editor view' }} {@attach keepPillAligned}>
						<Tabs.Trigger value="write">Write</Tabs.Trigger>
						<Tabs.Trigger value="preview">Preview</Tabs.Trigger>
					</Tabs.List>
				</Tabs.Root>
			{/if}
			<Button class="guidelines-save" loading={saving} disabled={!ready || over || !dirty || drafting || proposal !== null || !!blockedReason} onclick={() => void save()}>
				{primaryLabel} <kbd class="keycap">⌘↵</kbd>
			</Button>
			<Button variant="ghost" size="icon" aria-label="Close" disabled={saving} onclick={() => guidelinesStore.close()}><X size={16} aria-hidden="true" /></Button>
		</header>

		{#if loadError}
			<div class="guidelines-doc">
				<Alert.Root variant="error">
					<Alert.Title>{loadError}</Alert.Title>
					<Button variant="outline" class="mt-2 w-fit" onclick={() => editing && guidelinesStore.open(editing)}>Retry</Button>
				</Alert.Root>
			</div>
		{:else if !ready}
			<div class="guidelines-doc guidelines-loading" role="status" aria-label="Loading guidelines">
				<Skeleton class="h-4 w-24" />
				{#each ['w-2/3', 'w-5/6', 'w-1/2', 'w-3/4', 'w-2/5'] as w, i (i)}<Skeleton class="h-3.5 rounded-md {w}" />{/each}
			</div>
		{:else}
			<ScrollArea class="guidelines-scroll" showCues={false} aria-label="Guidelines">
				<div class="guidelines-doc">
					{#if proposal !== null && drafting}
						<!-- A partial revision would diff as mostly deletions; stream it as text, diff once done. -->
						<div class="guidelines-preview">
							{#if proposal}<Markdown content={proposal} streaming />{:else}<Markdown content={previewText} />{/if}
						</div>
					{:else if proposal !== null}
						<FileDiff.Root class="guidelines-proposal-diff" lang="markdown">
							<FileDiff.Content>
								{#each lineDiff(text, proposal) as line, i (i)}
									<FileDiff.Row type={line.type} oldLine={line.oldLineNumber} newLine={line.newLineNumber} code={line.content} />
								{/each}
							</FileDiff.Content>
						</FileDiff.Root>
					{:else if pane === 'write'}
						<Textarea bind:value={text} autoresize class="guidelines-input" spellcheck="true" aria-label="Guidelines (Markdown)" readonly={drafting} />
					{:else if hasRules}
						<div class="guidelines-preview"><Markdown content={previewText} streaming={drafting} /></div>
					{:else}
						<p class="guidelines-empty">{drafting ? 'Drafting…' : 'No rules yet. Write them, or describe what matters below and Recoder drafts them.'}</p>
					{/if}
				</div>
			</ScrollArea>

			<div class="guidelines-dock">
				{#if proposal !== null}
					<div class="guidelines-proposal-bar">
						<span class="min-w-0 flex-1 truncate">{drafting ? 'Revising your guidelines…' : 'Proposed revision'}</span>
						<Button variant="ghost" disabled={drafting} onclick={() => (proposal = null)}>Discard</Button>
						<Button variant="outline" disabled={drafting} onclick={acceptProposal}>Accept</Button>
					</div>
				{/if}
				{#if proposal === null && !drafting}
					<div class="guidelines-presets" role="group" aria-label="Suggested requests">
						{#each presets as preset (preset.label)}
							<Button variant="outline" class="guidelines-preset" title={preset.prompt} onclick={() => {
								if ('instructions' in preset) include.instructions = true;
								void draft(preset.prompt);
							}}>{preset.label}</Button>
						{/each}
					</div>
				{/if}
				{#if draftError || saveError || blockedReason}
					<p class="guidelines-error" role="alert">{draftError ?? saveError ?? blockedReason}</p>
				{/if}
				<ReviewComposer
					bind:value={prompt}
					label="Ask Recoder to draft or revise these guidelines"
					placeholder={hasRules
						? 'Ask for changes, e.g. stop flagging naming; money math must use Decimal'
						: editing?.kind === 'repo'
							? 'What should reviewers care about in this repo?'
							: 'What should reviewers care about in every review?'}
					generating={drafting}
					disabled={proposal !== null && !drafting}
					onSubmit={(value) => void draft(value)}
					onStop={() => abort?.abort()}
					leading={editing?.kind === 'repo' ? sources : undefined}
				/>
			</div>
		{/if}
	</Modal.Content>
</Modal.Root>
