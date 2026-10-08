<script lang="ts">
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Checkbox } from '@sivir-ui/svelte/components/checkbox';
	import type { DatasetPr } from '$lib/reports/types';

	let { prs, picked = $bindable() }: { prs: DatasetPr[]; picked: string[] } = $props();

	const codebases = $derived([...new Set(prs.map((pr) => pr.codebase))]);

	function toggle(id: string, on: boolean): void {
		picked = on ? [...picked, id] : picked.filter((item) => item !== id);
	}

	function pickCodebase(codebase: string): void {
		picked = prs.filter((pr) => pr.codebase === codebase).map((pr) => pr.id);
	}
</script>

<div class="form-actions mb-3">
	<span class="text-[12.5px] text-fg-muted">
		{picked.length ? `${picked.length} of ${prs.length} PRs` : `Every PR, ${prs.length} in all`}
	</span>
	{#each codebases as codebase (codebase)}
		<Button variant="ghost" onclick={() => pickCodebase(codebase)}>{codebase}</Button>
	{/each}
	<Button variant="ghost" disabled={!picked.length} onclick={() => (picked = [])}>Clear</Button>
</div>
<div class="pr-picks">
	{#each prs as pr (pr.id)}
		<Checkbox
			checked={picked.includes(pr.id)}
			onCheckedChange={(on) => toggle(pr.id, on)}
			label={pr.defects ? `${pr.id} · ${pr.defects} defects` : pr.id}
		/>
	{/each}
</div>
