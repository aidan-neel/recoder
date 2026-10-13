<script lang="ts">
	import type { QueueSection } from '$lib/queue/queue';

	interface Props {
		sections: QueueSection[];
	}

	let { sections }: Props = $props();

	const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

	const count = (id: QueueSection['id']) => sections.find((section) => section.id === id)?.entries.length ?? 0;
	const needs = $derived(count('needs-you'));

	const lead = $derived(
		needs === 0
			? 'Nothing needs you.'
			: `${WORDS[needs] ?? needs} pull request${needs === 1 ? '' : 's'} need${needs === 1 ? 's' : ''} you.`
	);

	const rest = $derived(
		[
			[count('reviewing'), 'reviewing'],
			[count('not-reviewed'), 'not reviewed'],
			[count('with-agent'), 'with the agent'],
			[count('ready'), 'ready to merge']
		]
			.filter(([n]) => n)
			.map(([n, label]) => `${n} ${label}`)
			.join(', ')
	);
</script>

<h1 class="queue-headline">
	{lead}
	{#if rest}<span class="queue-headline-rest">{rest[0].toUpperCase()}{rest.slice(1)}.</span>{/if}
</h1>
