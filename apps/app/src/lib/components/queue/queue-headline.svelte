<script lang="ts">
	import type { QueueSection } from '$lib/queue/queue';

	interface Props {
		sections: QueueSection[];
	}

	let { sections }: Props = $props();

	const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

	const count = (id: QueueSection['id']) => sections.find((section) => section.id === id)?.entries.length ?? 0;
	const needs = $derived(count('needs-you'));
	const reviewing = $derived(count('reviewing'));
	const ready = $derived(count('ready'));

	const word = (n: number) => WORDS[n] ?? String(n);

	const lead = $derived(
		needs === 0
			? 'Nothing needs you right now.'
			: `${word(needs)} pull request${needs === 1 ? '' : 's'} need${needs === 1 ? 's' : ''} a decision.`
	);

	const rest = $derived.by(() => {
		const parts = [
			reviewing
				? `${reviewing === 1 ? 'one more is' : `${word(reviewing).toLowerCase()} more are`} being reviewed`
				: '',
			ready ? `${word(ready).toLowerCase()} ${ready === 1 ? 'is' : 'are'} ready to merge` : ''
		].filter(Boolean);

		if (parts.length === 0) return '';

		const sentence = parts.join(' and ');

		return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
	});
</script>

<p class="home-brief ai-voice queue-brief"><span class="text-fg">{lead}</span> {rest}</p>
