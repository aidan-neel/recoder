<script lang="ts">
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Popover from '@sivir-ui/svelte/components/popover';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import type { PendingNote } from '$lib/diff/note-draft';
	import { notesStore } from '$lib/findings/notes.svelte';
	import NoteComposer from '../findings/note-composer.svelte';

	interface Props {
		open: boolean;
		pending: PendingNote | null;
		/** Where the popover anchors, relative to the diff root. */
		anchorTop: number;
		anchorLeft: number;
		/** Hands a new selection to the chat instead of writing a note. */
		onAsk?: () => void;
		onSave: (body: string) => void;
	}

	let { open = $bindable(), pending, anchorTop, anchorLeft, onAsk, onSave }: Props = $props();
</script>

<Popover.Root bind:open placement="bottom-start" inert={false}>
	<Popover.Trigger
		unstyled
		tabindex={-1}
		aria-label="Review note anchor"
		class="pointer-events-none absolute size-0 min-h-0 min-w-0 overflow-hidden border-0 p-0 opacity-0"
		style="top: {anchorTop}px; left: {anchorLeft}px"
	/>
	<Popover.Content
		aria-label={pending?.mode === 'edit' ? 'Edit review note' : 'Discuss selected code'}
		class="w-[22rem] min-w-0 max-w-[calc(100vw-1rem)]"
		surfaceClass="!gap-3 !p-3"
		lockScroll={false}
	>
		{#if pending}
			<Typography.Metadata class="truncate font-mono text-xs" title={pending.file}
				>{pending.file.split('/').at(-1)}:{pending.startLine}{pending.endLine !== pending.startLine
					? `–${pending.endLine}`
					: ''} · {pending.side === 'old' ? 'Before' : 'After'}</Typography.Metadata
			>
			{#if onAsk && pending.mode === 'create'}
				<Button variant="secondary" class="w-full justify-start gap-2 font-normal" onclick={onAsk}
					><MessageSquare size={15} aria-hidden="true" />Ask about this code</Button
				>
			{/if}
			<NoteComposer
				initialBody={pending.mode === 'edit' && pending.id
					? (notesStore.items.find((note) => note.id === pending?.id)?.body ?? '')
					: ''}
				placeholder={pending.mode === 'edit' ? 'Edit note…' : 'Leave a note…'}
				onsave={onSave}
			/>
		{/if}
	</Popover.Content>
</Popover.Root>
