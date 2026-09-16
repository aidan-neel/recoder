<script lang="ts">
	import { untrack } from 'svelte';
	import { Input } from '@sivir-ui/svelte/components/input';

	interface Props {
		initialBody?: string;
		placeholder?: string;
		onsave: (body: string) => void;
	}

	let { initialBody = '', placeholder = 'Leave a note…', onsave }: Props = $props();

	let draft = $state(untrack(() => initialBody));
	let inputEl: HTMLInputElement | undefined = $state();

	$effect(() => {
		inputEl?.focus({ preventScroll: true });
	});

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' && !event.isComposing) {
			event.preventDefault();
			if (draft.trim()) onsave(draft);
		}
	}
</script>

<Input
	bind:element={inputEl}
	bind:value={draft}
	onkeydown={onKeydown}
	{placeholder}
	aria-label="Review note"
	class="shadow-[var(--elevation-float)]"
/>
