<script lang="ts">
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import FileTreeNode from './file-tree-node.svelte';
	import { changedFileCount, changedFiles } from '$lib/file-tree';
	import { sessionFile } from '$lib/session-file.svelte';
</script>

<aside
	aria-label="Session files"
	class="flex h-full w-[375px] shrink-0 flex-col gap-4 overflow-hidden bg-background p-3"
>
	<div class="rounded-lg border border-border bg-card p-3">
		<div class="flex items-center gap-2">
			<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-success" title="Linked repository"></span>
			<span class="min-w-0 flex-1 truncate text-[15px] font-semibold">acme/ledger-api</span>
		</div>
		<div class="mt-1.5 flex items-center justify-between gap-2 text-foreground-muted">
			<span class="flex items-center gap-1.5">
				<span class="rounded bg-secondary px-1 py-px font-mono text-[13px]">gh</span>
				<span class="font-mono text-[14px]">PR #4127</span>
			</span>
			<span class="text-[14px]">2 min ago</span>
		</div>
	</div>

	<div class="flex min-h-0 flex-1 flex-col gap-1.5">
		<div class="flex items-center justify-between px-1 text-[15px]">
			<span class="font-medium text-foreground">Changed files</span>
			<span class="font-mono text-[14px] text-foreground-muted">{changedFileCount}</span>
		</div>
		<ScrollArea aria-label="Changed files" class="min-h-0 flex-1">
			<div class="space-y-px pb-2">
			{#each changedFiles as node (node.name)}
				<FileTreeNode
					{node}
					selectedId={sessionFile.currentId}
					onSelect={(id) => sessionFile.select(id)}
				/>
			{/each}
			</div>
		</ScrollArea>
	</div>
</aside>
