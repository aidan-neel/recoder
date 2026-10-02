<script lang="ts">
	import GitCommitHorizontal from '@lucide/svelte/icons/git-commit-horizontal';
	import { Badge } from '@sivir-ui/svelte/components/badge';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { changesStore } from '$lib/diff/changes.svelte';
</script>

<Button variant="outline" class="gap-2" aria-haspopup="dialog" onclick={() => changesStore.show()}>
	<GitCommitHorizontal size={15} aria-hidden="true" />Changes
	{#if changesStore.count}<Badge variant="secondary" class="tabular-nums">{changesStore.count}</Badge>{/if}
</Button>
