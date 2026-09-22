<script lang="ts">
	import { tick } from 'svelte';
	import Search from '@lucide/svelte/icons/search';
	import { Checkbox } from '@sivir-ui/svelte/components/checkbox';
	import { Input } from '@sivir-ui/svelte/components/input';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import FileTreeNode from './file-tree-node.svelte';
	import { buildFileTree, changedFileCount, changedFiles, type FileBadge, type FindingKind, type TreeNode } from '$lib/file-tree';
	import type { FileDiff } from '@recoder/shared';
	import { findingsStore, type FindingSeverity } from '$lib/findings.svelte';
	import { sessionFile } from '$lib/session-file.svelte';

	interface Props {
		/** Live review diffs. Falls back to the mock tree when null. */
		fileDiffs?: FileDiff[] | null;
		onFileSelect?: () => void;
		inSheet?: boolean;
	}

	let { fileDiffs = null, onFileSelect, inSheet = false }: Props = $props();

	function selectFile(id: string): void {
		sessionFile.select(id);
		onFileSelect?.();
	}

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
			if (finding.status === 'dismissed' || !findingsStore.isShown(finding)) continue;
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
		onFileSelect?.();
		await tick();
		findingsStore.discuss(findingId);
		document.getElementById(`finding-${findingId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}

	/** When on, the tree hides files without open findings. */
	let onlyWithFindings = $state(false);
	let fileQuery = $state('');

	const filesWithFindings = $derived(new Set(badges.keys()));
	const findingsFileCount = $derived(filesWithFindings.size);

	/** Recursively keep matching files; drop folders left empty. */
	function filterTree(
		nodes: TreeNode[],
		withFindings: Set<string> | null,
		query: string
	): TreeNode[] {
		const q = query.trim().toLowerCase();
		const out: TreeNode[] = [];
		for (const node of nodes) {
			if (node.kind === 'file') {
				if (withFindings && !withFindings.has(node.id)) continue;
				if (q !== '' && !node.id.toLowerCase().includes(q) && !node.name.toLowerCase().includes(q)) {
					continue;
				}
				out.push(node);
			} else {
				const children = filterTree(node.children, withFindings, query);
				if (children.length > 0) out.push({ ...node, children });
			}
		}
		return out;
	}

	const visibleTree = $derived(
		onlyWithFindings || fileQuery.trim() !== ''
			? filterTree(tree, onlyWithFindings ? filesWithFindings : null, fileQuery)
			: tree
	);
	const visibleCount = $derived.by(() => {
		let n = 0;
		const walk = (nodes: TreeNode[]) => {
			for (const node of nodes) {
				if (node.kind === 'file') n += 1;
				else walk(node.children);
			}
		};
		walk(visibleTree);
		return n;
	});
</script>

<aside
	aria-label="Session files"
	class="flex h-full min-h-0 w-full shrink-0 flex-col gap-4 overflow-hidden bg-background p-4"
>
	<div class="flex min-h-0 flex-1 flex-col gap-3">
		<div class="flex items-center justify-between text-sm {inSheet ? 'pe-10' : ''}">
			<Typography.Title level={2} class="text-sm font-normal">Changed files</Typography.Title>
			<Typography.Metadata class="font-mono text-xs">
				{onlyWithFindings || fileQuery ? `${visibleCount} of ${fileCount}` : fileCount}
			</Typography.Metadata>
		</div>
		<div class="shrink-0">
			<Input
				placeholder="Search files"
				aria-label="Search files"
				bind:value={fileQuery}
				class="bg-transparent text-sm"
			>
				{#snippet leading()}<Search size={14} aria-hidden="true" />{/snippet}
			</Input>
		</div>
		<div class="flex items-center gap-2 px-1 py-1 text-[13px] text-foreground-muted select-none">
			<Checkbox
				bind:checked={onlyWithFindings}
				disabled={findingsFileCount === 0}
				label="Only show files with findings"
				class="min-w-0 flex-1"
			/>
			<span class="ml-auto shrink-0 font-mono text-[12px] opacity-70">{findingsFileCount}</span>
		</div>
		<ScrollArea aria-label="Changed files" class="min-h-0 flex-1" showCues={false}>
			<div class="space-y-px pb-2">
			{#each visibleTree as node (node.kind === 'file' ? node.id : node.name)}
				<FileTreeNode
					{node}
					selectedId={sessionFile.currentId}
					onSelect={selectFile}
					{badges}
					onJump={(fileId, findingId) => void jumpToFinding(fileId, findingId)}
				/>
			{:else}
				<Typography.Text class="px-2 py-3 text-sm text-foreground-muted">
					{#if fileQuery.trim() !== ''}
						No files match “{fileQuery.trim()}”.
					{:else}
						No files with findings. Clear the filter to see all changed files.
					{/if}
				</Typography.Text>
			{/each}
			</div>
		</ScrollArea>
	</div>
</aside>
