<script lang="ts">
	interface Props {
		value: number;
		max: number;
		size?: number;
	}

	let { value, max, size = 16 }: Props = $props();

	const R = 6;
	const C = 2 * Math.PI * R;
	const done = $derived(max > 0 && value >= max);
</script>

<svg class="progress-ring" data-done={done} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
	<circle class="progress-ring-track" cx="8" cy="8" r={R} />
	<circle
		class="progress-ring-fill"
		cx="8"
		cy="8"
		r={R}
		stroke-dasharray={C}
		stroke-dashoffset={C * (1 - (max ? value / max : 0))}
	/>
	<path class="progress-ring-check" d="M5.4 8.2 7.2 10l3.4-3.8" />
</svg>
