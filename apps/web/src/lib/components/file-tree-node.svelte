<script lang="ts">
	import { untrack } from 'svelte';
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Collapsible from '@sivir-ui/svelte/components/collapsible';
	import { FINDING_DOT, type FileBadge, type TreeNode } from '$lib/file-tree';
	import { getFileIcon, getFolderIcon } from '$lib/file-icons';
	import { folderOpen } from '$lib/folder-open.svelte';
	import FileTreeNode from './file-tree-node.svelte';

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
		<Collapsible.Trigger
		class="flex h-9 w-full items-center gap-1.5 rounded-md px-1 text-left text-[16px] text-foreground-muted transition-colors hover:bg-secondary/60 hover:text-foreground"
		>
			{#if open}
				<Minus size={12} />
			{:else}
				<Plus size={12} />
			{/if}
			<span class="flex shrink-0 items-center [&>svg]:h-4 [&>svg]:w-4">
				{@html getFolderIcon(node.name, open)}
			</span>
			<span class="font-mono text-[15px]">{node.name}</span>
		</Collapsible.Trigger>
		<Collapsible.Content class="ml-[9px] space-y-px border-l border-dotted border-border py-px pl-2">
			{#each node.children as child (child.kind === 'file' ? child.id : child.name)}
				<FileTreeNode node={child} {selectedId} {onSelect} parentPath={fullPath} {badges} {onJump} />
			{/each}
		</Collapsible.Content>
	</Collapsible.Root>
{:else}
	{@const selected = node.id === selectedId}
	{@const badge = badges?.get(node.id)}
	<div
		class="flex h-9 w-full items-center gap-2 rounded-md px-2 transition-colors {selected
			? 'bg-secondary text-foreground'
			: 'text-foreground-muted hover:bg-secondary/60 hover:text-foreground'}"
	>
		<Button
			unstyled
			onclick={() => onSelect(node.id)}
			aria-current={selected}
			aria-label="Show {node.name}"
			class="flex min-w-0 flex-1 items-center gap-2 text-left"
		>
			<span class="flex shrink-0 items-center [&>svg]:h-4 [&>svg]:w-4">
				{@html getFileIcon(node.name)}
			</span>
			<span class="min-w-0 flex-1 truncate font-mono text-[15px]">{node.name}</span>
			<span class="flex shrink-0 items-center gap-1.5 font-mono text-[14px] select-none">
				{#if node.additions > 0}
					<span class="text-success">+{node.additions}</span>
				{/if}
				{#if node.deletions > 0}
					<span class="text-error">-{node.deletions}</span>
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
				class="shrink-0 font-mono text-[12px] select-none"
				style={`color: ${FINDING_DOT[badge.kind]}`}
			>
				{badge.count}
			</Button>
		{/if}
	</div>
{/if}
