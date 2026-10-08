<script lang="ts">
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Progress } from '@sivir-ui/svelte/components/progress';
	import { shortDate, shortModel } from '$lib/reports/stats';
	import type { ActiveRun } from '$lib/reports/types';

	let { run }: { run: ActiveRun } = $props();

	/** The PRs a run covers, shortened when it names many. */
	const prs = $derived(
		!run.only ? 'every PR' : run.only.length > 3 ? `${run.only[0]} … ${run.only.at(-1)}` : run.only.join(', ')
	);
</script>

<li>
	<Button href="/active/{run.host}/{run.pid}" variant="ghost" class="run-row">
		<span class="run-row-main">
			<span class="run-row-name">{run.dataset} · {prs}</span>
			<span class="run-row-meta"
				>{run.hostLabel} · pid {run.pid} · {shortDate(run.startedAt)} · {run.reviews.length} running · judge {shortModel(
					run.judge
				)}</span
			>
		</span>
		<span class="run-row-progress">
			<span>{run.done}/{run.expected ?? '?'} reviews</span>
			<Progress value={run.done} max={run.expected ?? 1} indeterminate={!run.expected} />
		</span>
		<span class="run-row-score">{run.planted ? `${run.found}/${run.planted} found` : 'no score yet'}</span>
	</Button>
</li>
