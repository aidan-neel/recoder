<script lang="ts">
	import type { Repo, Review } from '@recoder/shared';
	import { Badge } from '@sivir-ui/svelte/components/badge';
	import * as HoverCard from '@sivir-ui/svelte/components/hover-card';
	import ProviderMark from '$lib/components/settings/provider-mark.svelte';
	import { prStatus, shortAge, type BriefPick } from '$lib/home/home';

	interface Props {
		item: BriefPick;
		/** The link text, as the brief wrote it. */
		text: string;
		onOpen: (review: Review, repo: Repo) => void;
	}

	let { item, text, onOpen }: Props = $props();

	const status = $derived(prStatus(item.review));
</script>

<HoverCard.Root openDelay={250}>
	<HoverCard.Trigger
		href={item.review ? `/session/${item.review.id}` : item.pr.url}
		class="brief-ref"
		{...item.review
			? {
					onclick: (event: MouseEvent) => {
						event.preventDefault();
						if (item.review) onOpen(item.review, item.repo);
					}
				}
			: { target: '_blank', rel: 'noopener noreferrer' }}>{text}</HoverCard.Trigger
	><HoverCard.Content
		side="bottom"
		align="start"
		class="pr-card"
		{...{
			onclick: () => {
				if (item.review) onOpen(item.review, item.repo);
				else window.open(item.pr.url, '_blank', 'noopener,noreferrer');
			}
		}}
	>
		<div class="flex items-center gap-2 font-mono text-[11.5px] text-fg-faint">
			<ProviderMark provider={item.repo.provider} size={12} />
			<span class="truncate">{item.repo.name}</span>
			<span>#{item.pr.number}</span>
		</div>
		<HoverCard.Title class="pr-card-title">{item.pr.title || `PR #${item.pr.number}`}</HoverCard.Title>
		<HoverCard.Description class="pr-card-meta">
			<span class="truncate text-fg-subtle">{item.pr.headRef}</span>
			<span aria-hidden="true">→</span>
			<span>{item.pr.base}</span>
		</HoverCard.Description>
		<div class="pr-card-meta">
			<span>{item.pr.changedFiles} file{item.pr.changedFiles === 1 ? '' : 's'}</span>
			<span class="text-ok">+{item.pr.additions}</span>
			<span class="text-danger">−{item.pr.deletions}</span>
			{#if item.pr.createdAt}<span aria-hidden="true">·</span><span>{shortAge(item.pr.createdAt)} old</span>{/if}
			<span aria-hidden="true">·</span><span class="truncate">{item.pr.author}</span>
		</div>
		<div class="mt-2 flex items-center justify-between gap-2">
			{#if status}
				<Badge variant="secondary" class="status-chip" data-tone={status.tone}>{status.label}</Badge>
			{:else}
				<span class="shimmer-text text-[12px]">Review running</span>
			{/if}
			<span class="text-[11.5px] text-fg-faint"
				>{item.review
					? 'Click to open the review'
					: 'Click to open on ' + (item.repo.provider === 'gitlab' ? 'GitLab' : 'GitHub')}</span
			>
		</div>
	</HoverCard.Content></HoverCard.Root
>
