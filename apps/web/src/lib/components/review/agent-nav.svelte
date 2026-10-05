<script lang="ts">
	import type { ReviewAssignment } from '@recoder/shared';
	import { ORCHESTRATOR_ID } from '@recoder/shared';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import { formatAgentName } from '$lib/findings/threads.svelte';
	import { statusFor, type OpenProps } from '$lib/review/reviewing-view';

	/** The bar above a subagent's conversation: back to the orchestrator, its name and its status. */
	let {
		assignment,
		active,
		embedded,
		openProps
	}: { assignment: ReviewAssignment; active: boolean; embedded: boolean; openProps: OpenProps } = $props();

	const status = $derived(statusFor(assignment, active));

	/** Every subagent shares a role, so its header also names the question it took. */
	const name = $derived(
		assignment.role === 'subagent'
			? `${formatAgentName(assignment.role)} · ${assignment.title}`
			: formatAgentName(assignment.role)
	);
</script>

<nav
	aria-label="Agent conversation"
	class="agent-nav mx-auto flex w-full max-w-[740px] shrink-0 items-center {embedded ? 'px-3' : 'px-6'} pt-3"
>
	<Button
		{...openProps(ORCHESTRATOR_ID)}
		variant="ghost"
		size="icon"
		class="shrink-0"
		aria-label="Back to Orchestrator"
		title="Back to Orchestrator"
	>
		<ArrowLeft size={15} aria-hidden="true" />
	</Button>
	<Typography.Title level={2} class="agent-name min-w-0 truncate" title={name}>{name}</Typography.Title>
	<Typography.Metadata class="agent-status ms-auto shrink-0" data-tone={status.tone}>
		{#if assignment.status === 'running' && active}<Spinner size={12} aria-hidden="true" />{/if}
		{status.label}
	</Typography.Metadata>
</nav>
