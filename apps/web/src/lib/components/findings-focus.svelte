<script lang="ts">
	import type { ReviewToolCall } from '@recoder/shared';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import CheckCheck from '@lucide/svelte/icons/check-check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import ScanSearch from '@lucide/svelte/icons/scan-search';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import FileIcon from '@lucide/svelte/icons/file';
	import ListFilter from '@lucide/svelte/icons/list-filter';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import Search from '@lucide/svelte/icons/search';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import { Input } from '@sivir-ui/svelte/components/input';
	import { Markdown } from '@sivir-ui/svelte/components/markdown';
	import * as Popover from '@sivir-ui/svelte/components/popover';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import CodeDiff from './code-diff.svelte';
	import FindingSeverity from './finding-severity.svelte';
	import FixButton from './fix-button.svelte';
	import SuggestedFix from './suggested-fix.svelte';
	import EvidenceView from './evidence-view.svelte';
	import { collapse } from '$lib/collapse';
	import { evidenceView } from '$lib/evidence';
	import FixStatus from './fix-status.svelte';
	import FixChecks from './fix-checks.svelte';
	import SeverityPill from './ui/severity-pill.svelte';
	import type { FileDiff } from '$lib/diff';
	import { SEVERITIES, findingsStore, type Finding } from '$lib/findings.svelte';
	import { formatAgentName, threadsStore } from '$lib/threads.svelte';
	import { modelLabel } from '$lib/model-settings.svelte';

	interface Props {
		files: FileDiff[];
		toolCalls?: ReviewToolCall[];
		branch?: string | null;
		/** Open the whole file in the inline diff. */
		onFullFile: (finding: Finding) => void;
		/** Open a file in the inline diff at a line (the evidence's "Open in diff"). */
		onOpenAt?: ((file: string, line: number | null) => void) | null;
		/** Where the review is, for the empty state. */
		status?: 'draft' | 'running' | 'failed' | 'done';
		onStartReview?: (() => Promise<void>) | null;
		onOpenDiff?: (() => void) | null;
		onAsk?: (() => void) | null;
		onConversation?: (() => void) | null;
		onRestart?: (() => void) | null;
	}
	let { files, toolCalls = [], branch = null, onFullFile, onOpenAt = null, status = 'done', onStartReview = null, onOpenDiff = null, onAsk = null, onConversation = null, onRestart = null }: Props = $props();

	/* Empty states: what the page says when there's nothing in the list. */
	const fixedCount = $derived(findingsStore.items.filter((f) => f.status === 'accepted').length);
	const dismissedCount = $derived(findingsStore.items.filter((f) => f.status === 'dismissed').length);
	const hiddenCount = $derived(findingsStore.items.filter((f) => f.status === 'open' && !findingsStore.isShown(f)).length);
	const emptyKind = $derived(
		status === 'draft' ? 'draft'
			: status === 'running' ? 'running'
			: status === 'failed' && findingsStore.items.length === 0 ? 'failed'
			: findingsStore.items.length === 0 ? 'clean'
			: 'caught-up'
	);
	const additions = $derived(files.reduce((sum, file) => sum + file.additions, 0));
	const deletions = $derived(files.reduce((sum, file) => sum + file.deletions, 0));
	let starting = $state(false);
	async function start(): Promise<void> {
		if (!onStartReview || starting) return;
		starting = true;
		try { await onStartReview(); } finally { starting = false; }
	}

	const RANK = { high: 0, medium: 1, low: 2, info: 3 } as const;
	let query = $state('');
	const ranked = $derived(findingsStore.items
		.filter((finding) => finding.status !== 'dismissed' && findingsStore.isShown(finding))
		.filter((finding) => !query.trim() || `${finding.title} ${finding.body} ${finding.file} ${finding.category}`.toLowerCase().includes(query.trim().toLowerCase()))
		.sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.file.localeCompare(b.file) || a.startLine - b.startLine));
	const active = $derived(ranked.find((finding) => finding.id === findingsStore.activeId) ?? ranked[0]);
	const suggestion = $derived(active ? findingsStore.suggestions[active.id] : undefined);

	/** The finding's hunk, trimmed to its lines plus three either side. */
	const focused = $derived.by((): FileDiff | null => {
		if (!active) return null;
		const file = files.find((item) => item.path === active.file);
		if (!file) return null;
		const hunk = file.hunks.find((item) => item.lines.some((line) => line.newNo !== null && line.newNo >= active.startLine && line.newNo <= active.endLine))
			?? file.hunks.find((item) => active.startLine >= item.newStart && active.startLine < item.newStart + Math.max(1, item.newCount));
		if (!hunk) return null;
		const near = (n: number | null) => n !== null && n >= active.startLine - 3 && n <= active.endLine + 3;
		const first = hunk.lines.findIndex((line) => near(line.newNo));
		const last = hunk.lines.findLastIndex((line) => near(line.newNo));
		const lines = first < 0 ? hunk.lines : hunk.lines.slice(first, last + 1);
		return { ...file, hunks: [{ ...hunk, lines }] };
	});
	const range = $derived.by(() => {
		const numbers = focused?.hunks[0].lines.map((line) => line.newNo).filter((n): n is number => n !== null) ?? [];
		return numbers.length ? [Math.min(...numbers), Math.max(...numbers)] : null;
	});
	const evidence = $derived.by(() => {
		if (!active?.evidenceIds?.length) return null;
		const cited = toolCalls.filter((tool) => tool.result?.evidenceId && active.evidenceIds!.includes(tool.result.evidenceId) && tool.result.content);
		return cited.find((tool) => tool.assignmentId === active.assignmentId) ?? cited[0] ?? null;
	});

	/** "Open in diff" only when the cited file is part of this pull request. */
	const evidenceInDiff = $derived.by(() => {
		const shown = evidence ? evidenceView(evidence) : null;
		return !!shown && shown.kind !== 'text' && files.some((file) => file.path === shown.file);
	});

	function select(finding: Finding): void {
		findingsStore.discuss(finding.id);
	}
	function discuss(finding: Finding): void {
		findingsStore.discuss(finding.id);
		threadsStore.open(finding.id);
	}
	function dismiss(finding: Finding): void {
		findingsStore.dismiss(finding.id);
		if (threadsStore.openId === finding.id) threadsStore.close();
	}
	const dir = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);
	const base = (path: string) => path.slice(path.lastIndexOf('/') + 1);
</script>

{#snippet ghostCards(shimmer: boolean)}
	<div class="focus-empty-ghosts" data-shimmer={shimmer || undefined} aria-hidden="true">
		{#each ['high', 'medium', 'low'] as sev, i (sev)}
			<div class="focus-empty-ghost" style="--i: {i}">
				<span class="focus-empty-ghost-pill" data-sev={sev}></span>
				<span class="focus-empty-ghost-line" style="width: {[58, 72, 46][i]}%"></span>
				<span class="focus-empty-ghost-line is-faint" style="width: {[86, 64, 78][i]}%"></span>
			</div>
		{/each}
	</div>
{/snippet}

{#if ranked.length === 0 && !query.trim()}
	<div class="focus-empty" data-kind={emptyKind}>
		<div class="focus-empty-card enter-rise">
			<span class="focus-empty-icon" aria-hidden="true">
				{#if emptyKind === 'draft'}<ScanSearch size={20} />
				{:else if emptyKind === 'running'}<Spinner size={18} />
				{:else if emptyKind === 'failed'}<CircleAlert size={20} />
				{:else if emptyKind === 'clean'}<CircleCheck size={20} />
				{:else}<CheckCheck size={20} />{/if}
			</span>
			<Typography.Title level={2} class="focus-empty-title">
				{emptyKind === 'draft' ? 'No findings yet' : emptyKind === 'running' ? 'Reviewing this pull request' : emptyKind === 'failed' ? "The review didn't finish" : emptyKind === 'clean' ? 'Nothing to fix' : 'All caught up'}
			</Typography.Title>
			<p class="focus-empty-text">
				{#if emptyKind === 'draft'}Run the full review and specialists will check every change. Findings land here, ranked by severity.
				{:else if emptyKind === 'running'}Specialists are working through the diff. Findings appear here once the review consolidates them.
				{:else if emptyKind === 'failed'}No findings were saved. Restart the review to try again.
				{:else if emptyKind === 'clean'}The review found nothing in this pull request that needs a change.
				{:else}Every finding is fixed, dismissed or hidden by a filter.{/if}
			</p>
			<div class="focus-empty-facts">
				{#if emptyKind === 'caught-up'}
					{#if fixedCount}<span><b class="text-success">{fixedCount}</b> fixed</span>{/if}
					{#if dismissedCount}<span><b>{dismissedCount}</b> dismissed</span>{/if}
					{#if hiddenCount}<span><b>{hiddenCount}</b> hidden</span>{/if}
				{:else if files.length}
					<span><b>{files.length}</b> {files.length === 1 ? 'file' : 'files'}</span>
					<span><b class="text-success">+{additions}</b> <b class="text-danger">−{deletions}</b></span>
				{/if}
			</div>
			<div class="focus-empty-actions">
				{#if emptyKind === 'draft' && onStartReview}
					<Button variant="primary" loading={starting} disabled={starting} onclick={() => void start()}>Start review</Button>
				{:else if emptyKind === 'running' && onConversation}
					<Button variant="outline" onclick={onConversation}>Watch progress</Button>
				{:else if emptyKind === 'failed' && onRestart}
					<Button variant="primary" onclick={onRestart}>Restart review</Button>
				{:else if emptyKind === 'caught-up' && hiddenCount}
					<Button variant="outline" onclick={() => findingsStore.showAllSeverities()}>Show all severities</Button>
				{/if}
				{#if onOpenDiff && emptyKind !== 'failed'}<Button variant="ghost" onclick={onOpenDiff}>Open diff</Button>{/if}
				{#if onAsk && emptyKind !== 'running'}<Button variant="ghost" class="gap-1.5" onclick={onAsk}><MessageSquare size={14} aria-hidden="true" />Ask reviewer</Button>{/if}
			</div>
		</div>
		{#if emptyKind === 'draft' || emptyKind === 'running'}{@render ghostCards(emptyKind === 'running')}{/if}
	</div>
{:else}
<div class="focus-body">
	<section class="focus-list" aria-label="Findings that need you">
		<header class="focus-list-head">
			<Typography.Title level={2} class="focus-list-title">Needs you</Typography.Title>
			<span class="focus-list-meta"><span class="font-mono">{ranked.length}</span> by severity</span>
			<span class="ms-auto"></span>
			<Popover.Root placement="bottom-end">
				<Popover.Trigger variant="ghost" size="icon" aria-label="Filter by severity"><ListFilter size={15} aria-hidden="true" /></Popover.Trigger>
				<Popover.Content class="w-auto" surfaceClass="!p-2">
					<Popover.Title class="sr-only">Severities</Popover.Title>
					<div class="flex gap-1.5">
						{#each SEVERITIES as severity (severity)}
							<FindingSeverity {severity} count={findingsStore.items.filter((item) => item.status !== 'dismissed' && item.severity === severity).length} interactive pressed={findingsStore.isSeverityShown(severity)} onToggle={() => findingsStore.toggleSeverity(severity)} />
						{/each}
					</div>
				</Popover.Content>
			</Popover.Root>
			<Popover.Root placement="bottom-end">
				<Popover.Trigger variant="ghost" size="icon" aria-label="Search findings"><Search size={15} aria-hidden="true" /></Popover.Trigger>
				<Popover.Content class="w-72" surfaceClass="!p-2">
					<Popover.Title class="sr-only">Search findings</Popover.Title>
					<Input bind:value={query} placeholder="Search text or file…" aria-label="Search findings" />
				</Popover.Content>
			</Popover.Root>
		</header>
		<ScrollArea class="min-h-0 flex-1" showCues={false} aria-label="Findings">
			<div class="focus-cards">
				{#each ranked as finding, i (finding.id)}
					{@const isActive = finding.id === active?.id}
					<div class="focus-card-slot" in:collapse out:collapse>
					<Card.Root class="focus-card enter-rise" data-active={isActive || undefined} {...{ style: `--i: ${i}` }}>
						<Button unstyled class="focus-card-select" aria-current={isActive || undefined} onclick={() => select(finding)}>
							<span class="focus-card-head">
								<FindingSeverity severity={finding.severity} />
								<span class="min-w-0 truncate">{finding.category}</span>
								<span class="focus-card-loc" title="{finding.file}:{finding.startLine}">{finding.file}:{finding.startLine}</span>
								{#if findingsStore.suggestions[finding.id]}
									{@const fix = findingsStore.suggestions[finding.id]}
									{@const fixState = fix.apply === 'applied' || finding.status === 'accepted' ? 'fixed' : fix.status === 'loading' ? 'fixing' : fix.status === 'ready' ? 'ready' : 'failed'}
									<span class="focus-card-fix" data-state={fixState}>{#if fixState === 'fixing'}<Spinner size={10} aria-hidden="true" />{/if}{fixState === 'fixing' ? 'Fixing' : fixState === 'ready' ? 'Fix ready' : fixState === 'fixed' ? 'Fixed' : 'Fix failed'}</span>
								{/if}
							</span>
							<span class="focus-card-body ai-voice">{finding.title}</span>
						</Button>
						<!-- Always rendered; opens on the active card with a height transition (no jump). -->
						<div class="focus-card-reveal" inert={!isActive}>
							<div class="focus-card-reveal-clip">
								<div class="focus-card-foot">
									<span class="min-w-0 flex-1 truncate">{formatAgentName(finding.agent)}</span>
									<Button variant="ghost" onclick={() => dismiss(finding)}>Dismiss</Button>
									<Button variant="outline" class="gap-1.5" onclick={() => discuss(finding)}><MessageSquare size={14} aria-hidden="true" />Discuss</Button>
								</div>
							</div>
						</div>
					</Card.Root>
					</div>
				{:else}
					<Typography.Text class="px-1 py-3 text-sm text-fg-muted">{query ? 'No findings match your search.' : 'Nothing needs you. Every finding is fixed, dismissed or filtered out.'}</Typography.Text>
				{/each}
			</div>
		</ScrollArea>
	</section>

	<ScrollArea class="min-h-0" showCues={false} aria-label="Focused finding">
		{#if active}
			{#key active.id}
			<div class="focus-detail-column">
				<Card.Root class="focus-hunk">
					<header class="focus-hunk-head">
						<FileIcon size={14} class="shrink-0 text-fg-faint" aria-hidden="true" />
						<span class="diff-file-path" title={active.file}><span class="diff-file-dir">{dir(active.file)}</span><span class="diff-file-name">{base(active.file)}</span></span>
						{#if range}<span class="focus-hunk-range">lines {range[0]}–{range[1]}</span>{/if}
						<Button variant="ghost" class="ms-auto gap-1.5" onclick={() => onFullFile(active)}>Full file <ArrowUpRight size={13} aria-hidden="true" /></Button>
					</header>
					{#if focused}
						{#key active.id}<CodeDiff diff={focused} findings={[active]} cards={false} />{/key}
					{:else}
						<Typography.Text class="px-5 py-4 text-sm text-fg-muted">The diff for this file isn't loaded yet.</Typography.Text>
					{/if}
				</Card.Root>

				<Card.Root class="focus-detail">
					<div class="focus-detail-head">
						{#if active.status === 'accepted'}<SeverityPill tone="success">Fixed</SeverityPill>{:else}<FindingSeverity severity={active.severity} />{/if}
						<Typography.Title level={3} class="focus-detail-title">{active.title}</Typography.Title>
						<span class="focus-detail-meta">{[active.code, formatAgentName(active.agent), modelLabel(active.model)].filter(Boolean).join(' · ')}</span>
					</div>
					<div class="focus-detail-body ai-voice"><Markdown content={active.body} /></div>
					{#if evidence}<EvidenceView tool={evidence} onOpenInDiff={evidenceInDiff ? onOpenAt : null} />{/if}
					<FixStatus finding={active} />
					{#if suggestion?.status === 'ready' && suggestion.patch}<SuggestedFix {suggestion} /><FixChecks finding={active} />{/if}
					<div class="focus-detail-foot">
						<span class="min-w-0 flex-1 truncate">{#if branch}Pushes one commit to <span class="font-mono">{branch}</span>{/if}</span>
						{#if active.status === 'open'}
							<Button variant="ghost" onclick={() => dismiss(active)}>Dismiss</Button>
							<Button variant="outline" class="gap-1.5" onclick={() => discuss(active)}><MessageSquare size={14} aria-hidden="true" />Discuss</Button>
						{/if}
						<FixButton finding={active} />
					</div>
				</Card.Root>
			</div>
			{/key}
		{/if}
	</ScrollArea>
</div>

{/if}
