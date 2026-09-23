<script lang="ts">
	import { Skeleton, type SkeletonProps } from '@sivir-ui/svelte/components/skeleton';

	/** Sivir Skeleton with the design's shimmer (#1c1b19 → #262422, 1.4s). */
	let { class: className = '', ...rest }: SkeletonProps = $props();
</script>

<Skeleton class="rc-skeleton {className}" {...rest} />
