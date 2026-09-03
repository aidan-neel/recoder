<script lang="ts">
	import { tick } from 'svelte';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import FileTreeNode from './file-tree-node.svelte';
	import { buildFileTree, changedFileCount, changedFiles, type FileBadge, type FindingKind } from '$lib/file-tree';
	import type { FileDiff } from '@recoder/shared';
	import { findingsStore, type FindingSeverity } from '$lib/findings.svelte';
	import { sessionFile } from '$lib/session-file.svelte';

	interface Props {
		/** Live review diffs. Falls back to the mock tree when null. */
		fileDiffs?: FileDiff[] | null;
		repoName?: string;
		prLabel?: string;
	}

	let { fileDiffs = null, repoName = 'acme/ledger-api', prLabel = 'PR #4127' }: Props = $props();

	const tree = $derived(fileDiffs ? buildFileTree(fileDiffs) : changedFiles);
	const fileCount = $derived(fileDiffs ? fileDiffs.length : changedFileCount);

	const severityRank: Record<FindingSeverity, number> = { high: 0, medium: 1, low: 2, info: 3 };
	const severityKind: Record<FindingSeverity, FindingKind> = {
		high: 'error',
		medium: 'warning',
		low: 'info',
		info: 'info'
	};

	/** Open findings per file → badge with count, strongest severity, first finding. */
	const badges = $derived.by(() => {
		const byFile = new Map<string, typeof findingsStore.items>();
		for (const finding of findingsStore.items) {
			if (finding.status === 'dismissed') continue;
			const list = byFile.get(finding.file) ?? [];
			list.push(finding);
			byFile.set(finding.file, list);
		}
		const map = new Map<string, FileBadge>();
		for (const [file, list] of byFile) {
			const sorted = [...list].sort(
				(a, b) => severityRank[a.severity] - severityRank[b.severity] || a.startLine - b.startLine
			);
			const top = [...list].sort((a, b) => a.startLine - b.startLine)[0];
			map.set(file, { count: list.length, kind: severityKind[sorted[0].severity], findingId: top.id });
		}
		return map;
	});

	/** Select the file, then scroll its finding card into view. */
	async function jumpToFinding(fileId: string, findingId: string): Promise<void> {
		sessionFile.select(fileId);
		await tick();
		findingsStore.discuss(findingId);
		document.getElementById(`finding-${findingId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}
</script>

<aside
	aria-label="Session files"
	class="session-enter flex h-full w-[375px] shrink-0 flex-col gap-4 overflow-hidden bg-background p-3"
>
	<div class="rounded-lg border border-border bg-card p-3">
		<div class="flex items-center gap-2">
			<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-success" title="Linked repository"></span>
			<span class="min-w-0 flex-1 truncate text-[15px] font-semibold">{repoName}</span>
		</div>
		<div class="mt-1.5 flex items-center justify-between gap-2 text-foreground-muted">
			<span class="flex items-center gap-1.5">
				<span class="rounded bg-secondary px-1 py-px font-mono text-[13px]">gh</span>
				<span class="font-mono text-[14px]">{prLabel}</span>
			</span>
			<span class="text-[14px]">2 min ago</span>
		</div>
	</div>

	<div class="flex min-h-0 flex-1 flex-col gap-1.5">
		<div class="flex items-center justify-between px-1 text-[15px]">
			<span class="font-medium text-foreground">Changed files</span>
			<span class="font-mono text-[14px] text-foreground-muted">{fileCount}</span>
		</div>
		<ScrollArea aria-label="Changed files" class="min-h-0 flex-1">
			<div class="space-y-px pb-2">
			{#each tree as node (node.kind === 'file' ? node.id : node.name)}
				<FileTreeNode
					{node}
					selectedId={sessionFile.currentId}
					onSelect={(id) => sessionFile.select(id)}
					{badges}
					onJump={(fileId, findingId) => void jumpToFinding(fileId, findingId)}
				/>
			{/each}
			</div>
		</ScrollArea>
	</div>
</aside>
