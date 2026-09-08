<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import * as AlertDialog from '@sivir-ui/svelte/components/alert-dialog';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import Shortcut from '@sivir-ui/svelte/components/shortcut';
	import { Skeleton } from '@sivir-ui/svelte/components/skeleton';
import { tick } from 'svelte';
import {
	SEVERITIES,
	findingsStore,
	type Finding,
	type FindingSeverity
} from '$lib/findings.svelte';
import { sessionFile } from '$lib/session-file.svelte';
import { serverApi } from '$lib/server-api';
import { threadsStore } from '$lib/threads.svelte';

	const sevLabel: Record<FindingSeverity, string> = {
		high: 'High',
		medium: 'Medium',
		low: 'Low',
		info: 'Info'
	};

	const pillStyle: Record<FindingSeverity, string> = {
		high: 'bg-error/30 text-error',
		medium: 'bg-warning/30 text-warning',
		low: 'bg-[#1a2740] text-[#7eb0ff]',
		info: 'bg-secondary text-foreground'
	};

	/** Severities currently filtered out of navigation. */
	let hidden = $state(new Set<FindingSeverity>());
	let index = $state(0);

	const openItems = $derived(findingsStore.items.filter((f) => f.status !== 'dismissed'));

	const counts = $derived(
		Object.fromEntries(SEVERITIES.map((s) => [s, openItems.filter((f) => f.severity === s).length])) as Record<
			FindingSeverity,
			number
		>
	);

	const visible = $derived(
		openItems
			.filter((f) => !hidden.has(f.severity) && findingsStore.isShown(f))
			.sort((a, b) => a.startLine - b.startLine || a.id.localeCompare(b.id))
	);

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

	function toggle(severity: FindingSeverity): void {
		if (hidden.has(severity)) hidden.delete(severity);
		else hidden.add(severity);
	}

	const reviewId = $derived(threadsStore.reviewId);
	const fixable = $derived(
		openItems.filter((f) => f.status === 'open' && findingsStore.isShown(f))
	);
	const fixAllDisabled = $derived(fixable.length === 0 || !reviewId);

	interface FixAllItem {
		id: string;
		code: string | null;
		file: string;
		line: number;
		summary: string;
		patch: string;
		applies: boolean | null;
		error: string | null;
		pushed: boolean;
		pushError: string | null;
	}

	let fixAllConfirmOpen = $state(false);
	let fixAllPreviewOpen = $state(false);
	let fixAllPhase = $state<'suggesting' | 'ready' | 'applying' | 'done'>('suggesting');
	let fixAllItems = $state<FixAllItem[]>([]);
	let fixAllError = $state<string | null>(null);
	let fixAllResult = $state<{ sha: string; branch: string; count: number } | null>(null);

	const pushableCount = $derived(
		fixAllItems.filter((i) => !i.error && i.patch !== '' && !i.pushed).length
	);

	function toFixInput(finding: Finding): {
		file: string;
		line: number;
		endLine: number;
		severity: string;
		message: string;
	} {
		return {
			file: finding.file,
			line: finding.startLine,
			endLine: finding.endLine,
			severity: finding.severity,
			message: finding.body
		};
	}

	/** Confirm → generate a suggested patch per open finding, then preview. */
	async function confirmFixAll(): Promise<void> {
		const rid = reviewId;
		if (!rid) return;
		fixAllConfirmOpen = false;
		fixAllItems = [];
		fixAllError = null;
		fixAllResult = null;
		fixAllPhase = 'suggesting';
		fixAllPreviewOpen = true;
		for (const finding of fixable) {
			const existing = findingsStore.suggestions[finding.id];
			if (existing?.status === 'ready' && existing.patch) {
				fixAllItems = [
					...fixAllItems,
					{
						id: finding.id,
						code: finding.code,
						file: finding.file,
						line: finding.startLine,
						summary: existing.summary ?? finding.body,
						patch: existing.patch,
						applies: existing.applies ?? null,
						error: null,
						pushed: false,
						pushError: null
					}
				];
				continue;
			}
			findingsStore.suggesting(finding.id);
			try {
				const result = await serverApi.suggestFix(rid, {
					agent: finding.agent,
					finding: toFixInput(finding)
				});
				findingsStore.suggestReady(finding.id, {
					summary: result.summary,
					patch: result.patch,
					applies: result.applies
				});
				fixAllItems = [
					...fixAllItems,
					{
						id: finding.id,
						code: finding.code,
						file: finding.file,
						line: finding.startLine,
						summary: result.summary,
						patch: result.patch,
						applies: result.applies,
						error: null,
						pushed: false,
						pushError: null
					}
				];
			} catch (e) {
				const error = e instanceof Error ? e.message : 'Could not suggest a fix.';
				findingsStore.suggestError(finding.id, error);
				fixAllItems = [
					...fixAllItems,
					{
						id: finding.id,
						code: finding.code,
						file: finding.file,
						line: finding.startLine,
						summary: finding.body,
						patch: '',
						applies: null,
						error,
						pushed: false,
						pushError: null
					}
				];
			}
		}
		fixAllPhase = 'ready';
	}

	/** Push every generated patch to the PR head branch, then mark findings fixed. */
	async function pushFixAll(): Promise<void> {
		const rid = reviewId;
		if (!rid || fixAllPhase !== 'ready') return;
		fixAllPhase = 'applying';
		fixAllError = null;
		let pushed = 0;
		let last: { sha: string; branch: string } | null = null;
		for (const item of fixAllItems) {
			if (item.error || item.patch === '' || item.pushed) continue;
			const finding = findingsStore.items.find((f) => f.id === item.id);
			if (!finding) continue;
			findingsStore.applyingFix(item.id);
			try {
				const result = await serverApi.applyFix(rid, {
					finding: toFixInput(finding),
					summary: item.summary,
					patch: item.patch
				});
				findingsStore.applyReady(item.id, { sha: result.sha, branch: result.branch });
				findingsStore.accept(item.id, finding.agent);
				item.pushed = true;
				pushed += 1;
				last = result;
			} catch (e) {
				const error = e instanceof Error ? e.message : 'Could not apply the fix.';
				findingsStore.applyFailed(item.id, error);
				item.pushError = error;
			}
		}
		fixAllPhase = 'done';
		if (last) fixAllResult = { ...last, count: pushed };
		else if (pushed === 0) fixAllError = 'No fixes could be pushed.';
	}

	// Hijack browser find: Ctrl/Cmd+F steps through findings instead.
	function onKeydown(event: KeyboardEvent): void {
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
			event.preventDefault();
			go(position + 1);
		}
	}

	$effect(() => {
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});
</script>

<div class="session-enter flex shrink-0 items-center gap-2" style="animation-delay: 60ms">
	<div class="flex h-9 items-center gap-0.5 rounded-lg border border-border bg-card px-1.5">
		<span class="px-1.5 text-[15px] text-foreground-muted">Finding</span>
		<span class="font-mono text-[14px]">
			{visible.length === 0 ? 0 : position + 1} of {visible.length}
		</span>
		<Button
			variant="ghost"
			size="icon"
			aria-label="Previous finding"
			disabled={visible.length === 0}
			onclick={() => go(position - 1)}
		>
			<ChevronUp size={14} />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			aria-label="Next finding"
			title="Next finding (Ctrl+F)"
			disabled={visible.length === 0}
			onclick={() => go(position + 1)}
		>
			<ChevronDown size={14} />
		</Button>
	</div>

	{#each SEVERITIES as severity (severity)}
		{#if severity === 'info'}
			<label
				title={findingsStore.hideInfo ? 'Show info findings' : 'Hide info findings'}
				class="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 font-sans text-[14px] font-medium transition-all {pillStyle.info} {findingsStore.hideInfo
					? 'opacity-40'
					: ''}"
			>
				<input
					type="checkbox"
					class="peer sr-only"
					checked={!findingsStore.hideInfo}
					onchange={(e) => findingsStore.setHideInfo(!e.currentTarget.checked)}
				/>
				<span
					class="flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border border-border bg-background peer-checked:border-primary peer-checked:bg-primary"
					aria-hidden="true"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="3"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="size-2.5 text-[var(--color-on-primary)] {findingsStore.hideInfo
							? 'opacity-0'
							: 'opacity-100'}"
					>
						<path d="M20 6 9 17l-5-5" />
					</svg>
				</span>
				Info
				<span>{counts.info}</span>
			</label>
		{:else}
			<button
				type="button"
				onclick={() => toggle(severity)}
				aria-pressed={!hidden.has(severity)}
				title="Toggle {severity} findings"
				class="flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 font-sans text-[14px] font-medium transition-all {pillStyle[
					severity
				]} {hidden.has(severity) ? 'opacity-40' : ''}"
			>
				{sevLabel[severity]}
				<span>{counts[severity]}</span>
			</button>
		{/if}
	{/each}

	<div class="ml-auto flex min-w-0 shrink-0 items-center gap-2">
		<Button
			variant="primary"
			size="sm"
			class="h-9 shrink-0 font-sans"
			disabled={fixAllDisabled}
			title={reviewId
				? `Generate fixes for ${fixable.length} open finding${fixable.length === 1 ? '' : 's'}`
				: 'Needs a backend review'}
			onclick={() => (fixAllConfirmOpen = true)}
		>
			Fix all ({fixable.length})
		</Button>
	</div>

	<AlertDialog.Root bind:open={fixAllConfirmOpen}>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Fix all {fixable.length} finding{fixable.length === 1 ? '' : 's'}?</AlertDialog.Title>
				<AlertDialog.Description>
					This requests a fix for each open finding. Nothing is pushed yet — you review
					the patches first.
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Exit>
					Cancel
					<Shortcut shortcut="esc" />
				</AlertDialog.Exit>
				<AlertDialog.Confirm onclick={() => void confirmFixAll()}>
					Generate fixes
					<Shortcut shortcut="enter" />
				</AlertDialog.Confirm>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>

	<AlertDialog.Root bind:open={fixAllPreviewOpen}>
		<AlertDialog.Content size="lg">
			<AlertDialog.Header>
				<AlertDialog.Title>Review fixes</AlertDialog.Title>
				<AlertDialog.Description>
					{#if fixAllPhase === 'done' && fixAllResult}
						Pushed {fixAllResult.count} fix{fixAllResult.count === 1 ? '' : 'es'} to
						{fixAllResult.branch} ({fixAllResult.sha.slice(0, 7)}).
					{:else}
						Review the generated patches below. Approving pushes them to the PR head
						branch.
					{/if}
				</AlertDialog.Description>
			</AlertDialog.Header>
			{#if fixAllPhase === 'suggesting'}
				<div class="flex flex-col gap-2" role="status" aria-label="Generating fixes">
					<Skeleton class="h-[68px] w-full rounded-lg" />
					<Skeleton class="h-[68px] w-full rounded-lg" />
				</div>
			{:else}
				<ScrollArea aria-label="Generated fixes" class="max-h-96">
					<div class="grid gap-2 pr-2">
						{#each fixAllItems as item (item.id)}
							<div class="overflow-hidden rounded-lg border border-border" aria-label="Fix preview">
								<div class="flex items-center gap-2 border-b border-border bg-background px-3 py-1.5">
									{#if item.code}
										<span class="font-mono text-[13px] font-semibold">{item.code}</span>
									{/if}
									<span class="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground-muted">
										{item.file}:{item.line}
									</span>
									{#if item.pushed}
										<span class="shrink-0 rounded bg-success/15 px-1.5 py-0.5 font-sans text-[12px] font-semibold text-success">
											Pushed
										</span>
									{:else if item.error}
										<span class="shrink-0 rounded bg-error/15 px-1.5 py-0.5 font-sans text-[12px] font-semibold text-error">
											Failed
										</span>
									{:else if item.applies === true}
										<span class="shrink-0 rounded bg-success/15 px-1.5 py-0.5 font-sans text-[12px] font-semibold text-success">
											Applies cleanly
										</span>
									{:else if item.applies === false}
										<span class="shrink-0 rounded bg-error/15 px-1.5 py-0.5 font-sans text-[12px] font-semibold text-error">
											May not apply
										</span>
									{/if}
								</div>
								{#if item.error}
									<p class="m-0 px-3 py-2 text-[13px] font-medium text-error" role="alert">
										{item.error}
									</p>
								{:else}
									<p class="m-0 truncate px-3 pt-2 text-[13px] font-medium">{item.summary}</p>
									<pre class="m-0 max-h-56 overflow-auto bg-background p-2.5 font-mono text-[12px] leading-relaxed">{#each item.patch.split('\n') as line, i (i)}<div
												class={line.startsWith('+') && !line.startsWith('+++')
													? 'text-success'
													: line.startsWith('-') && !line.startsWith('---')
														? 'text-error'
														: 'text-foreground-muted'}>{line || ' '}</div
											>{/each}</pre>
								{/if}
								{#if item.pushError}
									<p class="m-0 px-3 py-2 text-[13px] font-medium text-error" role="alert">
										{item.pushError}
									</p>
								{/if}
							</div>
						{/each}
					</div>
				</ScrollArea>
			{/if}
			{#if fixAllError}
				<p class="mt-2 text-[13px] font-medium text-error" role="alert">{fixAllError}</p>
			{/if}
			<AlertDialog.Footer>
				{#if fixAllPhase === 'done'}
					<AlertDialog.Exit>
						Done
						<Shortcut shortcut="esc" />
					</AlertDialog.Exit>
				{:else}
					<AlertDialog.Exit disabled={fixAllPhase === 'applying'}>
						Cancel
						<Shortcut shortcut="esc" />
					</AlertDialog.Exit>
					<AlertDialog.Confirm
						disabled={fixAllPhase !== 'ready' || pushableCount === 0}
						loading={fixAllPhase === 'applying'}
						loadingLabel="Pushing…"
						onclick={() => void pushFixAll()}
					>
						Push {pushableCount} fix{pushableCount === 1 ? '' : 'es'}
						<Shortcut shortcut="enter" />
					</AlertDialog.Confirm>
				{/if}
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
</div>
