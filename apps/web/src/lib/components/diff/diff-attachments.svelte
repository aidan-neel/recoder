<script lang="ts">
	import Pencil from '@lucide/svelte/icons/pencil';
	import { Badge } from '@sivir-ui/svelte/components/badge';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import { CodeBlock } from '@sivir-ui/svelte/components/code-block';
	import { Markdown } from '@sivir-ui/svelte/components/markdown';
	import { findingsStore, type Finding } from '$lib/findings/findings.svelte';
	import type { ReviewNote } from '$lib/findings/notes.svelte';
	import { collapse } from '$lib/shell/collapse';
	import FindingCard from '../findings/finding-card.svelte';

	interface Props {
		/** Notes anchored under this row. */
		notes: ReviewNote[];
		/** Findings whose card anchors under this row. */
		findings: Finding[];
		/** Off where the finding sits beside the code instead. */
		cards: boolean;
		onEdit: (note: ReviewNote) => void;
	}

	let { notes, findings, cards, onEdit }: Props = $props();
</script>

{#each notes as note (note.id)}
	<div
		id={`note-${note.id}`}
		data-note-card
		class="diff-attachment {findingsStore.suppressHover ? 'pointer-events-none' : ''}"
	>
		<article>
			<Card.Root class="inline-finding">
				<div class="inline-finding-head">
					<Badge variant="info">Note</Badge>
					<span class="min-w-0 flex-1 truncate font-mono"
						>{note.file}:{note.startLine === note.endLine ? note.startLine : `${note.startLine}-${note.endLine}`}</span
					>
					<Button variant="ghost" size="icon" class="shrink-0" aria-label="Edit note" onclick={() => onEdit(note)}
						><Pencil size={13} /></Button
					>
				</div>
				{#if note.quote}<CodeBlock code={note.quote} lang="plaintext" copy="overlay" class="mt-2 max-h-32" />{/if}
				<div class="mt-1.5 min-w-0 text-[13.5px]"><Markdown content={note.body} /></div>
			</Card.Root>
		</article>
	</div>
{/each}
{#if cards}
	{#each findings as finding (finding.id)}
		<div
			id={`finding-${finding.id}`}
			class="diff-attachment {findingsStore.suppressHover ? 'pointer-events-none' : ''}"
			in:collapse
			out:collapse
		>
			<FindingCard {finding} />
		</div>
	{/each}
{/if}
