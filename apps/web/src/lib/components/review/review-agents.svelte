<script lang="ts">
	import type { ReviewAssignment } from '@recoder/shared';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { Badge } from '@sivir-ui/svelte/components/badge';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Collapsible from '@sivir-ui/svelte/components/collapsible';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import Disclosure from '../ui/disclosure.svelte';
	import ModelMarkdown from './model-markdown.svelte';
	import { formatAgentName } from '$lib/findings/threads.svelte';
	import { statusFor, type OpenProps } from '$lib/review/reviewing-view';
	import { groupProgress, groupAgents } from '$lib/review/agent-groups';
	import { modelLabel } from '$lib/settings/model-settings.svelte';

	/**
	 * The plan's reviewers in the orchestrator's transcript: why each role runs, then one row
	 * per role. A role with several parts (a large PR's correctness sweep) opens to them.
	 */
	let {
		agents,
		planSummary,
		finished,
		active,
		openProps
	}: {
		agents: ReviewAssignment[];
		planSummary: string | null;
		/** A finished review tucks the rows inside the disclosure. */
		finished: boolean;
		active: boolean;
		openProps: OpenProps;
	} = $props();

	const agentGroups = $derived(groupAgents(agents));
</script>

{#snippet agentRows()}
	<ul class="agent-list" aria-label="Agents">
		{#each agentGroups as group (group.role)}
			{#if group.items.length === 1}
				{@render agentRow(group.items[0], formatAgentName(group.role))}
			{:else}
				{@const status = statusFor({ ...group.items[0], status: group.status }, active)}
				<li>
					<Collapsible.Root>
						<Collapsible.Trigger
							class="agent-row agent-group-row"
							aria-label={`${formatAgentName(group.role)}: ${group.items.length}`}
						>
							<span class="agent-main">
								<span class="agent-name-line">
									<span class="agent-row-name">{formatAgentName(group.role)}</span>
									<span class="agent-count">×{group.items.length}</span>
									{#if group.items[0].model}<span class="agent-model" title={group.items[0].model}
											>{modelLabel(group.items[0].model)}</span
										>{/if}
								</span>
								<span class="agent-op">{groupProgress(group)}</span>
							</span>
							<Badge variant="secondary" class="status-chip" data-tone={status.tone}>
								{#if group.status === 'running' && active}<Spinner size={12} aria-hidden="true" />{/if}
								{status.label}
							</Badge>
							<ChevronRight size={16} class="agent-chevron" aria-hidden="true" />
						</Collapsible.Trigger>
						<Collapsible.Content>
							<ul class="agent-list agent-parts" aria-label={`${formatAgentName(group.role)} parts`}>
								{#each group.items as assignment (assignment.id)}
									{@render agentRow(assignment, assignment.title)}
								{/each}
							</ul>
						</Collapsible.Content>
					</Collapsible.Root>
				</li>
			{/if}
		{/each}
	</ul>
{/snippet}

{#snippet agentRow(assignment: ReviewAssignment, name: string)}
	{@const status = statusFor(assignment, active)}
	<li>
		<Button
			{...openProps(assignment.id)}
			variant="ghost"
			class="agent-row"
			aria-label={`Open ${formatAgentName(assignment.role)} conversation`}
		>
			<span class="agent-main">
				<span class="agent-name-line">
					<span class="agent-row-name">{name}</span>
					{#if assignment.model}<span class="agent-model" title={assignment.model}>{modelLabel(assignment.model)}</span
						>{/if}
				</span>
				<span class="agent-op" title={assignment.currentOperation || assignment.title}
					>{assignment.currentOperation || assignment.title}</span
				>
			</span>
			<Badge variant="secondary" class="status-chip" data-tone={status.tone}>
				{#if assignment.status === 'running' && active}<Spinner size={12} aria-hidden="true" />{/if}
				{status.label}
			</Badge>
			<ChevronRight size={16} class="agent-chevron" aria-hidden="true" />
		</Button>
	</li>
{/snippet}

<section class="agents" aria-label="Agents">
	<Disclosure>
		{#snippet label()}Started {agents.length} {agents.length === 1 ? 'agent' : 'agents'}{/snippet}
		{#if planSummary}<ModelMarkdown content={planSummary} />{/if}
		{#each agentGroups as group (group.role)}
			<Typography.Text
				><span class="text-fg-secondary"
					>{formatAgentName(group.role)}{group.items.length > 1 ? ` ×${group.items.length}` : ''}:</span
				>
				{group.items[0].reason || group.items[0].title}</Typography.Text
			>
		{/each}
		{#if finished}{@render agentRows()}{/if}
	</Disclosure>
	{#if !finished}{@render agentRows()}{/if}
</section>
