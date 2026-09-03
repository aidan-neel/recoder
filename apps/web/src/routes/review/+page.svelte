<script lang="ts">
	import { goto } from '$app/navigation';
	import ReviewProgress from '$lib/components/review-progress.svelte';

	const sessionHref = '/session/ledger-api';
</script>

<!-- Visual sandbox for the in-review state. The live version renders inside /session/[id]. -->
<ReviewProgress
	title="[DRAFT] Release v0.2.9"
	repo="acme/recoder"
	prLabel="#218"
	files={13}
	additions={1204}
	deletions={318}
	sessionHref={sessionHref}
	onOpenDiff={() => void goto(sessionHref)}
/>
