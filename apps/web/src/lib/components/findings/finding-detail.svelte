<script lang="ts">
	import type { ReviewToolCall } from '@recoder/shared';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import FileIcon from '@lucide/svelte/icons/file';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import type { FileDiff } from '$lib/diff/diff';
	import { evidenceView } from '$lib/findings/evidence';
	import { dismissFinding, discussFinding, restoreFinding } from '$lib/findings/finding-actions';
	import { VERIFY_METHOD_NOTES } from '$lib/findings/finding-labels';
	import { findingsStore, type Finding } from '$lib/findings/findings.svelte';
	import { formatAgentName } from '$lib/findings/threads.svelte';
	import { modelLabel } from '$lib/settings/model-settings.svelte';
	import CodeDiff from '../diff/code-diff.svelte';
	import ModelMarkdown from '../review/model-markdown.svelte';
	import SeverityPill from '../ui/severity-pill.svelte';
	import EvidenceView from './evidence-view.svelte';
	import FindingFacets from './finding-facets.svelte';
	import FindingSeverity from './finding-severity.svelte';
	import FixButton from './fix-button.svelte';
	import FixStatus from './fix-status.svelte';
	import SuggestedFix from './suggested-fix.svelte';
	import VerificationBadge from './verification-badge.svelte';

	interface Props {
		active: Finding;
		files: FileDiff[];
		toolCalls: ReviewToolCall[];
		/** Open the whole file in the inline diff. */
		onFullFile: (finding: Finding) => void;
		/** Open a file in the inline diff at a line (the evidence's "Open in diff"). */
		onOpenAt: ((file: string, line: number | null) => void) | null;
	}

	let { active, files, toolCalls, onFullFile, onOpenAt }: Props = $props();

	const fix = $derived(findingsStore.readyFix(active));

	/** The finding's hunk, trimmed to its lines plus three either side. */
	const focused = $derived.by((): FileDiff | null => {
		const file = files.find((item) => item.path === active.file);

		if (!file) return null;

		const hunk =
			file.hunks.find((item) =>
				item.lines.some((line) => line.newNo !== null && line.newNo >= active.startLine && line.newNo <= active.endLine)
			) ??
			file.hunks.find(
				(item) => active.startLine >= item.newStart && active.startLine < item.newStart + Math.max(1, item.newCount)
			);

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

	/** The first cited result in citation order (a verified finding cites its proving run first). */
	const evidence = $derived.by(() => {
		for (const id of active.evidenceIds ?? []) {
			const cited = toolCalls.filter((tool) => tool.result?.evidenceId === id && tool.result.content);
			const pick = cited.find((tool) => tool.assignmentId === active.assignmentId) ?? cited[0];

			if (pick) return pick;
		}

		return null;
	});

	/** "Open in diff" only when the cited file is part of this pull request. */
	const evidenceInDiff = $derived.by(() => {
		const shown = evidence ? evidenceView(evidence) : null;

		return !!shown && shown.kind !== 'text' && files.some((file) => file.path === shown.file);
	});

	const dir = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);
	const base = (path: string) => path.slice(path.lastIndexOf('/') + 1);
</script>

<div class="focus-detail-column">
	<Card.Root class="focus-hunk">
		<header class="focus-hunk-head">
			<FileIcon size={14} class="shrink-0 text-fg-faint" aria-hidden="true" />
			<span class="diff-file-path" title={active.file}
				><span class="diff-file-dir">{dir(active.file)}</span><span class="diff-file-name">{base(active.file)}</span
				></span
			>
			{#if range}<span class="focus-hunk-range">lines {range[0]}–{range[1]}</span>{/if}
			<Button variant="ghost" class="ms-auto gap-1.5" onclick={() => onFullFile(active)}
				>Full file <ArrowUpRight size={13} aria-hidden="true" /></Button
			>
		</header>
		{#if focused}
			<CodeDiff diff={focused} findings={[active]} cards={false} />
		{:else}
			<Typography.Text class="px-5 py-4 text-sm text-fg-muted">The diff for this file isn't loaded yet.</Typography.Text
			>
		{/if}
	</Card.Root>

	<Card.Root class="focus-detail">
		<div class="focus-detail-head">
			{#if active.status === 'dismissed'}<SeverityPill tone="info">Dismissed</SeverityPill>{:else}<FindingSeverity
					severity={active.severity}
				/>{#if active.verification}<VerificationBadge verification={active.verification} />{/if}{/if}
			<Typography.Title level={3} class="focus-detail-title">{active.title}</Typography.Title>
			<span class="focus-detail-meta"
				>{[active.code, formatAgentName(active.agent), modelLabel(active.model)].filter(Boolean).join(' · ')}</span
			>
		</div>
		<FindingFacets finding={active} class="focus-detail-facets" />
		<div class="focus-detail-body ai-voice"><ModelMarkdown content={active.body} /></div>
		{#if active.verification}
			<p class="verify-note" data-status={active.verification.status}>
				{#if active.verification.status === 'verified'}<CircleCheck
						size={14}
						class="verify-note-icon"
						aria-hidden="true"
					/>{:else}<CircleAlert size={14} class="verify-note-icon" aria-hidden="true" />{/if}
				<span>
					{active.verification.status !== 'verified'
						? 'Not verified'
						: VERIFY_METHOD_NOTES[active.verification.method ?? 'run']}: {active.verification.reason}
					{#if active.verification.command}<code>{active.verification.command}</code
						>{#if active.verification.exitCode !== undefined && active.verification.exitCode !== null}
							exited {active.verification.exitCode}.{/if}{/if}
				</span>
			</p>
		{/if}
		{#if evidence}<EvidenceView tool={evidence} onOpenInDiff={evidenceInDiff ? onOpenAt : null} />{/if}
		<FixStatus finding={active} />
		{#if fix}<SuggestedFix suggestion={fix} />{/if}
		<div class="focus-detail-foot">
			{#if active.status === 'open'}
				<Button variant="ghost" onclick={() => dismissFinding(active)}>Dismiss</Button>
				<Button variant="outline" class="gap-1.5" onclick={() => discussFinding(active)}
					><MessageSquare size={14} aria-hidden="true" />Discuss</Button
				>
			{/if}
			{#if active.status === 'dismissed'}
				<Button variant="primary" class="gap-1.5" onclick={() => restoreFinding(active)}
					><RotateCcw size={14} aria-hidden="true" />Restore</Button
				>
			{:else}
				<FixButton finding={active} />
			{/if}
		</div>
	</Card.Root>
</div>
