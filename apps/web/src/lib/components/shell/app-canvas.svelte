<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import * as Card from '@sivir-ui/svelte/components/card';

	interface Props {
		children: Snippet;
	}

	/** The canvas card under the top bar: 8px from the sides and bottom, radius 14. Shared with apps/app. */
	let { children }: Props = $props();
</script>

<main id="app-canvas" class="flex min-h-0 flex-1 px-2 pb-2" data-route={page.route.id}>
	<Card.Root
		class="app-canvas min-h-0 min-w-0 flex-1 gap-0 overflow-hidden rounded-[14px] border border-line-canvas bg-canvas p-0 shadow-none"
	>
		{@render children()}
	</Card.Root>
</main>
