<script lang="ts">
	import { paletteContext } from '$lib/palette.svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import Search from '@lucide/svelte/icons/search';
	import Wrench from '@lucide/svelte/icons/wrench';
	import type { Snippet } from 'svelte';
	import * as AlertDialog from '@sivir-ui/svelte/components/alert-dialog';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import { Input } from '@sivir-ui/svelte/components/input';
	import * as Popover from '@sivir-ui/svelte/components/popover';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import FindingSeverity from './finding-severity.svelte';
import { onDestroy, tick } from 'svelte';
import {
	SEVERITIES,
	findingsStore,
	type Finding,
	type FindingSeverity as Severity
} from '$lib/findings.svelte';
	import { sessionFile } from '$lib/session-file.svelte';
	import { threadsStore } from '$lib/threads.svelte';
	import { applyReadyFixes, fixFindings, hasReadyFix } from '$lib/fixes';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';

	/**
	 * `trailing`: status and actions shown before Fix all at the toolbar's right end.
	 * `part`: 'actions' renders only those actions + Fix all (the session header);
	 * 'nav' renders the findings stepper, severity filters and search as a
	 * sidebar section; 'all' is the original single toolbar.
	 */
	let { trailing, part = 'all' }: { trailing?: Snippet; part?: 'all' | 'nav' | 'actions' } = $props();
	let searchOpen = $state(false);
	let query = $state('');
	let index = $state(0);

	const openItems = $derived(findingsStore.items.filter((f) => f.status !== 'dismissed'));

	const counts = $derived(
		Object.fromEntries(SEVERITIES.map((s) => [s, openItems.filter((f) => f.severity === s).length])) as Record<
			Severity,
			number
		>
	);

	const visible = $derived(
		openItems
			.filter((f) => findingsStore.isShown(f))
			.sort((a, b) => a.file.localeCompare(b.file) || a.startLine - b.startLine || a.id.localeCompare(b.id))
	);
	const matches = $derived(visible.filter((finding) => `${finding.title} ${finding.body} ${finding.file} ${finding.code ?? ''} ${finding.category} ${finding.agent}`.toLowerCase().includes(query.trim().toLowerCase())));

	/** 0-based position of the current finding within the visible list. */
	const position = $derived.by(() => {
		const at = visible.findIndex((f) => f.id === findingsStore.activeId);
		if (at !== -1) return at;
		return Math.min(index, Math.max(0, visible.length - 1));
	});

	function scrollTo(id: string): void {
		document.getElementById(`finding-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}

	/** Jump to a finding, switching files first when it lives elsewhere. */
	async function jumpTo(finding: Finding): Promise<void> {
		searchOpen = false;
		if (finding.file !== sessionFile.currentId) {
			sessionFile.select(finding.file);
			await tick();
			// Let the new diff render before scrolling to the card.
			await tick();
		}
		findingsStore.discuss(finding.id);
		requestAnimationFrame(() => scrollTo(finding.id));
	}

	function go(i: number): void {
		if (visible.length === 0) return;
		index = (i + visible.length) % visible.length;
		void jumpTo(visible[index]);
	}

	function toggle(severity: Severity): void {
		findingsStore.toggleSeverity(severity);
	}

	const reviewId = $derived(threadsStore.reviewId);
	const fixable = $derived(
		openItems.filter((f) => f.status === 'open' && findingsStore.isShown(f))
	);

	let findingsCopied = $state(false);
	let findingsCopyTimer: ReturnType<typeof setTimeout> | undefined;
	onDestroy(() => clearTimeout(findingsCopyTimer));

	function fallbackCopyFindings(text: string): boolean {
		if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
			return false;
		}
		const textarea = document.createElement('textarea');
		textarea.value = text;
		textarea.style.position = 'fixed';
		textarea.style.opacity = '0';
		document.body.appendChild(textarea);
		textarea.select();
		const done = document.execCommand('copy');
		textarea.remove();
		return done;
	}

	async function copyFindings(): Promise<void> {
		let done = false;
		if (typeof navigator !== 'undefined' && navigator.clipboard) {
			try {
				await navigator.clipboard.writeText(copyText);
				done = true;
			} catch {
				done = fallbackCopyFindings(copyText);
			}
		} else {
			done = fallbackCopyFindings(copyText);
		}
		if (!done) return;
		findingsCopied = true;
		clearTimeout(findingsCopyTimer);
		findingsCopyTimer = setTimeout(() => (findingsCopied = false), 2000);
	}

	/** All non-dismissed findings in stable display order, formatted for pasting into an LLM. */
	const copyText = $derived.by(() => {
		const items = [...openItems].sort(
			(a, b) => a.file.localeCompare(b.file) || a.startLine - b.startLine || a.id.localeCompare(b.id)
		);
		if (items.length === 0) return 'No review findings.';
		const lines = [`# Code review findings (${items.length})`, ''];
		items.forEach((f, i) => {
			const range = f.startLine === f.endLine ? `${f.startLine}` : `${f.startLine}-${f.endLine}`;
			const status = f.status !== 'open' ? ` [${f.status}]` : '';
			lines.push(`## ${i + 1}. [${f.severity}] ${f.title} — ${f.file}:${range}${status}`);
			lines.push(`Reviewer: ${f.agent}${f.model ? ` (${f.model})` : ''}`);
			lines.push('');
			lines.push(f.body);
			lines.push('');
		});
		return lines.join('\n').trimEnd();
	});

	/* Fix all: specialists write a patch per finding in the background; each is
	   reviewed on its finding. The button follows along, then applies the ready ones. */
	const openList = $derived(openItems.filter((f) => f.status === 'open'));
	const writing = $derived(openList.filter((f) => findingsStore.suggestions[f.id]?.status === 'loading').length);
	const readyFixes = $derived(openList.filter(hasReadyFix));
	const applying = $derived(openList.some((f) => findingsStore.suggestions[f.id]?.apply === 'applying'));
	const toFix = $derived(fixable.filter((f) => { const s = findingsStore.suggestions[f.id]; return s?.status !== 'loading' && !hasReadyFix(f); }));
	let applyConfirmOpen = $state(false);

	const fixAllDisabled = $derived(toFix.length === 0 || !reviewId);
	$effect(() => {
		// Only the instance that owns Fix all registers it with ⌘K.
		if (part === 'nav') return;
		paletteContext.fixAll = fixAllDisabled
			? null
			: { count: toFix.length, run: () => startFixAll() };
		return () => {
			paletteContext.fixAll = null;
		};
	});

	function startFixAll(targets: Finding[] = toFix): void {
		searchOpen = false;
		void fixFindings(targets);
	}

	// Search findings without changing the active finding until a result is chosen.
	function onKeydown(event: KeyboardEvent): void {
		if (!event.defaultPrevented && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
			event.preventDefault();
			searchOpen = true;
		}
	}

	$effect(() => {
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});
</script>

{#snippet searchPanel()}
				<div class="flex items-center justify-between px-4 pb-2 pt-4">
					<Popover.Title class="text-sm font-medium">Findings</Popover.Title>
					<Typography.Metadata class="text-xs tabular-nums" role="status">{matches.length} {matches.length === 1 ? 'result' : 'results'}</Typography.Metadata>
				</div>
				<div class="px-3 pb-3"><Input variant="secondary" bind:value={query} placeholder="Search text or file…" aria-label="Search finding text or file" onkeydown={(event) => {
					if (event.key === 'Enter' && matches[0]) { event.preventDefault(); void jumpTo(matches[0]); }
				}}>
					{#snippet leading()}<Search size={15} aria-hidden="true" />{/snippet}
				</Input></div>
				<ScrollArea showCues={false} class="px-2" style="max-height: min(24rem, 45dvh)" aria-label="Matching findings">
					{#each matches as finding (finding.id)}
						<Button variant="ghost" class="!h-auto w-full min-w-0 !justify-start rounded-lg !px-2 !py-3 text-left !whitespace-normal" onclick={() => void jumpTo(finding)}>
							<span class="flex w-full min-w-0 items-start gap-3">
								<span class="w-8 shrink-0 pt-0.5"><FindingSeverity severity={finding.severity} /></span>
								<span class="flex min-w-0 flex-1 flex-col gap-1.5">
									<span class="text-sm font-normal leading-5 text-foreground">{finding.title}</span>
									<span class="truncate font-mono text-xs font-normal text-foreground-muted" title={`${finding.file}:${finding.startLine}`}>{finding.file}:{finding.startLine}</span>
								</span>
							</span>
						</Button>
					{:else}
						<Typography.Text class="px-2 py-4 text-sm text-foreground-muted">{query ? 'No findings match your search.' : 'No findings match the selected severities.'}</Typography.Text>
					{/each}
				</ScrollArea>
				<div class="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle p-3">
					<Button variant="ghost" disabled={openItems.length === 0} onclick={() => void copyFindings()} class="gap-2 text-sm !font-normal">
						{#if findingsCopied}<Check size={14} aria-hidden="true" />{:else}<Copy size={14} aria-hidden="true" />{/if}
						{findingsCopied ? 'Copied' : 'Copy findings'}
					</Button>
				</div>
{/snippet}

{#if part === 'nav'}
	{#if openItems.length > 0 || findingsStore.items.length > 0}
		<section class="findings-nav" aria-label="Findings">
			<div class="findings-nav-head">
				<span class="findings-nav-title">Findings</span>
				<span class="findings-nav-pos" aria-live="polite">{visible.length === 0 ? 0 : position + 1} / {visible.length}</span>
				<span class="findings-nav-steps">
					<Button variant="quiet" size="icon" aria-label="Previous finding" disabled={visible.length === 0} onclick={() => go(position - 1)}><ChevronUp size={14} /></Button>
					<Button variant="quiet" size="icon" aria-label="Next finding" title="Next finding" disabled={visible.length === 0} onclick={() => go(position + 1)}><ChevronDown size={14} /></Button>
				</span>
			</div>
			<div class="findings-nav-filters" role="group" aria-label="Show severities">
				{#each SEVERITIES as severity (severity)}
					<button type="button" class="findings-nav-filter" data-severity={severity} aria-pressed={findingsStore.isSeverityShown(severity)} onclick={() => toggle(severity)}>
						<span class="findings-nav-dot" aria-hidden="true"></span>
						<span class="findings-nav-label">{severity === 'medium' ? 'Med' : severity.charAt(0).toUpperCase() + severity.slice(1)}</span>
						<span class="findings-nav-count">{counts[severity]}</span>
					</button>
				{/each}
			</div>
			<Popover.Root bind:open={searchOpen} placement="bottom-start">
				<Popover.Trigger variant="ghost" class="findings-nav-search" aria-label="Search findings">
					<Search size={13} aria-hidden="true" /><span>Search findings…</span>
				</Popover.Trigger>
				<Popover.Content class="w-[28rem] max-w-[calc(100vw-2rem)]" surfaceClass="!gap-0 !p-0">{@render searchPanel()}</Popover.Content>
			</Popover.Root>
		</section>
	{/if}
{:else}
<div class="findings-toolbar flex w-full min-w-0 max-w-full shrink-0 flex-wrap items-center gap-2">
	{#if part === 'all'}
	<Card.Root class="!h-8 shrink-0 !flex-row items-center !gap-0 rounded-[9px] border-0 bg-transparent !p-0 shadow-none">
		<Popover.Root bind:open={searchOpen} placement="bottom-start">
			<Popover.Trigger variant="ghost" class="!h-8 gap-2 rounded-s-[9px] rounded-e-none !px-2.5 text-sm !font-normal" aria-label="Search findings">
				Findings
				<span class="font-mono text-xs tabular-nums text-foreground-muted">{visible.length === 0 ? 0 : position + 1}/{visible.length}</span>
			</Popover.Trigger>
			<Popover.Content class="w-[28rem] max-w-[calc(100vw-2rem)]" surfaceClass="!gap-0 !p-0">{@render searchPanel()}</Popover.Content>
		</Popover.Root>
		<Button
			variant="quiet"
			size="icon"
			class="!size-8 !min-w-8 rounded-none text-foreground-muted hover:text-foreground"
			aria-label="Previous finding"
			disabled={visible.length === 0}
			onclick={() => go(position - 1)}
		>
			<ChevronUp size={14} />
		</Button>
		<Button
			variant="quiet"
			size="icon"
			class="!size-8 !min-w-8 rounded-s-none rounded-e-[9px] text-foreground-muted hover:text-foreground"
			aria-label="Next finding"
			title="Next finding"
			disabled={visible.length === 0}
			onclick={() => go(position + 1)}
		>
			<ChevronDown size={14} />
		</Button>
	</Card.Root>

	{#each SEVERITIES as severity (severity)}
		<FindingSeverity
			{severity}
			count={counts[severity]}
			interactive
			pressed={findingsStore.isSeverityShown(severity)}
			onToggle={() => toggle(severity)}
		/>
	{/each}
	{/if}

	<div class="findings-toolbar-end">
		{@render trailing?.()}
		{#if writing}
			<Button class="fix-all gap-2" disabled aria-live="polite"><Spinner size={13} aria-hidden="true" />Writing {writing} {writing === 1 ? 'fix' : 'fixes'}</Button>
		{:else if applying}
			<Button class="fix-all gap-2" disabled aria-live="polite"><Spinner size={13} aria-hidden="true" />Applying</Button>
		{:else if readyFixes.length}
			<Button class="fix-all gap-2" onclick={() => { searchOpen = false; applyConfirmOpen = true; }}>
				<Check size={14} aria-hidden="true" />Apply fixes<span class="fix-all-count">{readyFixes.length}</span>
			</Button>
		{:else}
			<Button class="fix-all gap-2" disabled={toFix.length === 0 || !reviewId} onclick={() => startFixAll()}>
				<Wrench size={14} aria-hidden="true" />Fix all<span class="fix-all-count">{toFix.length}</span>
			</Button>
		{/if}
	</div>

	<AlertDialog.Root bind:open={applyConfirmOpen}>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Apply {readyFixes.length} {readyFixes.length === 1 ? 'fix' : 'fixes'}?</AlertDialog.Title>
				<AlertDialog.Description>Each fix is pushed as its own commit to the pull request branch. Review them on their findings first if you haven't.</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Exit>Cancel</AlertDialog.Exit>
				<AlertDialog.Confirm variant="primary" onclick={() => { applyConfirmOpen = false; void applyReadyFixes(readyFixes); }}>Apply {readyFixes.length} {readyFixes.length === 1 ? 'fix' : 'fixes'}</AlertDialog.Confirm>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
</div>
{/if}
