<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Tooltip from '@sivir-ui/svelte/components/tooltip';
	import Keycap from '../ui/keycap.svelte';
	import StatusGlyph from '../ui/status-glyph.svelte';
	import type { ReviewState } from '$lib/review/review-state.svelte';
	import type { Decision } from '$lib/review/surface';

	interface Props {
		decision: Decision;
		view: ReviewState;
	}

	let { decision, view }: Props = $props();

	const current = $derived(view.decisions.stateOf(decision.id));
	const index = $derived(view.surface?.decisions.findIndex((item) => item.id === decision.id) ?? 0);
	const total = $derived(view.surface?.decisions.length ?? 0);

	/** The likely call is the filled button: send back real risks, accept the rest. Positions never move. */
	const sendIsLikely = $derived(decision.tone === 'high' || decision.tone === 'medium' || decision.tone === 'question');

	const DONE = {
		accepted: 'Accepted. It ships as is.',
		sent: 'Sent back. It goes to the agent in the handoff.',
		dismissed: 'Not an issue. Recoder won’t raise it again.'
	} as const;

	function step(by: number): void {
		const decisions = view.surface?.decisions ?? [];
		const next = decisions[Math.min(decisions.length - 1, Math.max(0, index + by))];

		if (next) view.select({ kind: 'decision', id: next.id });
	}
</script>

<div class="decide-bar" data-state={current}>
	<div class="decide-swap swap">
		<div class="decide-actions" data-on={current === 'open'} inert={current !== 'open'}>
			<Button variant={sendIsLikely ? 'outline' : 'primary'} onclick={() => view.decide(decision.id, 'accepted')}>
				Accept <Keycap key="a" />
			</Button>
			<Button variant={sendIsLikely ? 'primary' : 'outline'} onclick={() => view.decide(decision.id, 'sent')}>
				Send back <Keycap key="s" />
			</Button>
			{#if decision.kind === 'finding'}
				<Button variant="ghost" onclick={() => view.decide(decision.id, 'dismissed')}>
					Not an issue <Keycap key="x" />
				</Button>
			{/if}
		</div>
		<div class="decide-done" data-on={current !== 'open'} inert={current === 'open'}>
			{#if current !== 'open'}
				<StatusGlyph kind={current === 'accepted' ? 'ok' : current} />
				<span class="decide-done-text">{DONE[current]}</span>
			{/if}
			<Button variant="ghost" onclick={() => view.undo()}>Undo <Keycap key="u" /></Button>
		</div>
	</div>

	<div class="decide-nav">
		<span class="decide-count tabular">{index + 1} of {total}</span>
		<Tooltip.Root placement="top">
			<Tooltip.Trigger>
				<Button
					variant="ghost"
					size="icon"
					aria-label="Previous decision"
					disabled={index === 0}
					onclick={() => step(-1)}
				>
					<ChevronUp size={16} />
				</Button>
			</Tooltip.Trigger>
			<Tooltip.Content>Previous <Keycap key="k" /></Tooltip.Content>
		</Tooltip.Root>
		<Tooltip.Root placement="top">
			<Tooltip.Trigger>
				<Button
					variant="ghost"
					size="icon"
					aria-label="Next decision"
					disabled={index === total - 1}
					onclick={() => step(1)}
				>
					<ChevronDown size={16} />
				</Button>
			</Tooltip.Trigger>
			<Tooltip.Content>Next <Keycap key="j" /></Tooltip.Content>
		</Tooltip.Root>
	</div>
</div>
