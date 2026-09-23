<script lang="ts">
	import { TaskSteps } from '@sivir-ui/svelte/components/task-steps';

	interface Props {
		/** Index of the running step; equal to the step count when done. */
		current: number;
		failed?: boolean;
		active: boolean;
		elapsed: string;
		/** "4 of 6" progress for the specialist step. */
		specialists?: { done: number; total: number } | null;
	}
	let { current, failed = false, active, elapsed, specialists = null }: Props = $props();

	const steps = $derived([
		{ id: 'checkout', label: 'Prepare repository' },
		{ id: 'plan', label: 'Plan review' },
		{ id: 'specialists', label: current === 2 && specialists?.total ? `Specialist reviews · ${specialists.done} of ${specialists.total}` : 'Specialist reviews' },
		{ id: 'consolidate', label: 'Consolidate findings' }
	]);
</script>

<div class="review-steps">
	<TaskSteps {steps} {current} {failed} label="Review progress" class="review-steps-list" />
	<span class="review-live" data-live={active || undefined} role="timer" aria-label="{active ? 'Live' : failed ? 'Stopped' : 'Finished'}, {elapsed} elapsed">
		<span class="review-live-dot" aria-hidden="true"></span>{active ? 'Live' : failed ? 'Stopped' : 'Finished'} · {elapsed}
	</span>
</div>
