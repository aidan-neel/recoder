<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		/** The key as the keyboard layer names it: `a`, `Enter`, `mod+k`. */
		key: string;
		class?: string;
	}

	let { key, class: className = '' }: Props = $props();

	const GLYPHS: Record<string, string> = {
		Enter: '↵',
		Escape: 'esc',
		ArrowUp: '↑',
		ArrowDown: '↓',
		ArrowLeft: '←',
		ArrowRight: '→',
		Backspace: '⌫',
		' ': 'space'
	};

	/** ⌘ until mount proves otherwise, so server and client render the same first frame. */
	let mod = $state('⌘');

	onMount(() => {
		if (!/Mac|iPhone|iPad/.test(navigator.userAgent)) mod = 'Ctrl ';
	});

	const label = $derived.by(() => {
		const plain = key.replace(/^mod\+/, '');
		const glyph = GLYPHS[plain] ?? plain.toUpperCase();

		return key.startsWith('mod+') ? `${mod}${glyph}` : glyph;
	});
</script>

<kbd class="keycap {className}" data-key={key}>{label}</kbd>
