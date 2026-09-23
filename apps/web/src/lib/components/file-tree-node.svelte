<script lang="ts">
	import { untrack } from 'svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import FileIcon from '@lucide/svelte/icons/file';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Collapsible from '@sivir-ui/svelte/components/collapsible';
	import { FINDING_DOT, type FileBadge, type TreeNode } from '$lib/file-tree';
	import { folderOpen } from '$lib/folder-open.svelte';
	import FileTreeNode from './file-tree-node.svelte';
	import { diffPrefs } from '$lib/diff-prefs.svelte';

	interface Props {
		node: TreeNode;
		selectedId: string;
		onSelect: (id: string) => void;
		parentPath?: string;
		badges?: Map<string, FileBadge>;
		onJump?: (fileId: string, findingId: string) => void;
	}

	let { node, selectedId, onSelect, parentPath = '', badges, onJump }: Props = $props();
	// Stable identity for this node instance (props never change per instance).
	const key = untrack(() =>
		node.kind === 'folder' ? (parentPath ? `${parentPath}/${node.name}` : node.name) : node.id
	);
	const fullPath = key;
	let open = $state(folderOpen.isOpen(key));

	$effect(() => {
		if (node.kind === 'folder') folderOpen.set(key, open);
	});
</script>

{#if node.kind === 'folder'}
	<Collapsible.Root bind:open>
		<Collapsible.Trigger class="tree-folder">
			<ChevronDown size={12} class="tree-chevron" aria-hidden="true" />
			<span class="truncate">{node.name}</span>
		</Collapsible.Trigger>
		<Collapsible.Content class="tree-children">
			{#each node.children as child (child.kind === 'file' ? child.id : child.name)}
				<FileTreeNode node={child} {selectedId} {onSelect} parentPath={fullPath} {badges} {onJump} />
			{/each}
		</Collapsible.Content>
	</Collapsible.Root>
{:else}
	{@const selected = node.id === selectedId}
	{@const badge = badges?.get(node.id)}
	<div class="tree-file" data-selected={selected || undefined} data-viewed={diffPrefs.isViewed(node.id) || undefined}>
		<Button
			unstyled
			onclick={() => onSelect(node.id)}
			aria-current={selected}
			aria-label="Show {node.name}"
			class="tree-file-select"
		>
			<FileIcon size={13} class="shrink-0 text-fg-faint" aria-hidden="true" />
			<span class="tree-file-name">{node.name}</span>
			<span class="tree-file-stats">
				{#if node.additions > 0}
					<span class="text-success">+{node.additions}</span>
				{/if}
				{#if node.deletions > 0}
					<span class="text-danger">−{node.deletions}</span>
				{/if}
				{#if !(badge && onJump) && node.finding}
					<span
						class="h-1.5 w-1.5 shrink-0 rounded-full"
						style:background-color={FINDING_DOT[node.finding]}
					></span>
				{/if}
			</span>
		</Button>
		{#if badge && onJump}
			<Button
				type="button"
				variant="quiet"
				size="icon"
				onclick={() => onJump(node.id, badge.findingId)}
				title="Jump to finding"
				aria-label="{badge.count} finding{badge.count === 1 ? '' : 's'} in {node.name} — jump to finding"
				class="tree-file-count"
				style={`color: ${FINDING_DOT[badge.kind]}`}
			>
				{badge.count}
			</Button>
		{/if}
	</div>
{/if}
