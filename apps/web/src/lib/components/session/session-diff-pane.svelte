<script lang="ts">
	import * as Alert from '@sivir-ui/svelte/components/alert';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import CodeDiff from '$lib/components/diff/code-diff.svelte';
	import DiffFileHeader from '$lib/components/diff/diff-file-header.svelte';
	import DiffSkeleton from '$lib/components/diff/diff-skeleton.svelte';
	import FindingsBar from '$lib/components/findings/findings-bar.svelte';
	import SessionSidebar from '$lib/components/session/session-sidebar.svelte';
	import { diffPrefs } from '$lib/diff/diff-prefs.svelte';
	import { setLocationNav } from '$lib/diff/location-nav';
	import { revealDiffLine } from '$lib/diff/reveal-line';
	import type { Finding } from '$lib/findings/findings.svelte';
	import { showDiffLine } from '$lib/session/file-focus.svelte';
	import { sessionFile } from '$lib/session/session-file.svelte';
	import { rootFontPx, trackPointerDrag, type PanelWidth } from '$lib/session/panel-width.svelte';
	import type { SessionReview } from '$lib/session/session-review.svelte';
	import type { FileDiff, ReviewCodeContext } from '@recoder/shared';

	/** The Diff view: the resizable file tree beside the selected file's diff. */
	interface Props {
		data: SessionReview;
		treeWidth: PanelWidth;
		sidePanelOpen: boolean;
		diff: FileDiff;
		findings: Finding[];
		activeRange: ReviewCodeContext | null;
		onAsk?: (context: ReviewCodeContext) => void;
		onClearRange: () => void;
	}

	let { data, treeWidth, sidePanelOpen, diff, findings, activeRange, onAsk, onClearRange }: Props = $props();

	const review = $derived(data.review);

	/** A related location's link: show its file (the user's pick), unhide the line if trimmed, scroll to it. */
	function openAt(file: string, line: number | null, side: 'old' | 'new'): void {
		sessionFile.select(file);
		showDiffLine(data.files, file, line, side);
		if (line !== null) revealDiffLine(line, side);
	}

	setLocationNav({ files: () => data.files, open: openAt });

	function startResize(event: PointerEvent): void {
		if (event.button !== 0) return;

		const startX = event.clientX;
		const start = treeWidth.value;
		const rootPx = rootFontPx();

		trackPointerDrag(event, (e) => treeWidth.set(start + (e.clientX - startX) / rootPx));
	}

	function resizeKey(event: KeyboardEvent): void {
		const { value, min, max } = treeWidth;
		const next = { ArrowLeft: value - 1, ArrowRight: value + 1, Home: min, End: max }[event.key];

		if (next === undefined) return;
		event.preventDefault();
		treeWidth.set(next);
	}
</script>

<div
	class="diff-tree hidden lg:block"
	data-beside-panel={sidePanelOpen || undefined}
	style="width: {treeWidth.value}rem"
>
	<SessionSidebar fileDiffs={data.isBackend ? (data.files ?? []) : null}>
		{#snippet header()}<FindingsBar part="nav" />{/snippet}
	</SessionSidebar>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<div
		class="tree-resizer"
		role="separator"
		aria-orientation="vertical"
		aria-label="Resize file tree"
		aria-valuemin={treeWidth.min * 16}
		aria-valuemax={treeWidth.max * 16}
		aria-valuenow={Math.round(treeWidth.value * 16)}
		tabindex="0"
		onpointerdown={startResize}
		onkeydown={resizeKey}
		ondblclick={() => treeWidth.set(treeWidth.initial)}
	></div>
</div>
<div id="diff-panel" class="relative flex min-h-0 min-w-0 flex-1 flex-col {sidePanelOpen ? 'max-xl:hidden' : ''}">
	{#if data.isBackend && review?.status === 'failed' && !data.files}
		<Alert.Root variant="error" class="m-4">
			<Alert.Title>Review failed</Alert.Title>
			<Alert.Description class="max-w-md"
				>{review.summary ?? 'The pipeline failed before producing a diff.'}</Alert.Description
			>
			<Alert.Description>Fix the cause, then restart the review from the conversation.</Alert.Description>
		</Alert.Root>
	{:else if data.isBackend && !data.files}
		<DiffSkeleton label="Fetching PR diff" />
	{:else}
		<DiffFileHeader {diff} />
		<ScrollArea orientation="vertical" aria-label="Code diff" class="min-h-0 flex-1" showCues={false}>
			{#key diff.path}
				<div class="min-w-0 page-enter">
					<CodeDiff {diff} {findings} mode={diffPrefs.mode} {onAsk} {activeRange} {onClearRange} />
				</div>
			{/key}
		</ScrollArea>
	{/if}
</div>
