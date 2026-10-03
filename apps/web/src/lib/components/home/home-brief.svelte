<script lang="ts">
	import Play from '@lucide/svelte/icons/play';
	import type { PullRequest, Repo, Review } from '@recoder/shared';
	import { Badge } from '@sivir-ui/svelte/components/badge';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import { serverApi } from '$lib/api/server-api';
	import Skeleton from '$lib/components/ui/skeleton.svelte';
	import {
		briefSegments,
		dayPart,
		fallbackBrief,
		firstName,
		highCount,
		pickToOpen,
		pickToReview,
		prKey,
		type BriefPick
	} from '$lib/home/home';
	import { openPrs } from '$lib/home/open-prs.svelte';
	import { recentSessions } from '$lib/session/recent-sessions.svelte';
	import { shellState } from '$lib/shell/shell-state.svelte';
	import BriefPrRef from './brief-pr-ref.svelte';

	interface Props {
		/** Every open PR with its repo and latest review. */
		items: BriefPick[];
		/** No model is set up, so the AI brief can't be written. */
		needsModel: boolean;
		/** Review request in flight, by `repoId#pr`. */
		starting: string | null;
		onStart: (pr: PullRequest, repo: Repo) => void;
		onOpen: (review: Review, repo: Repo) => void;
	}

	let { items, needsModel, starting, onStart, onOpen }: Props = $props();

	let briefLoading = $state(false);
	let briefFailed = $state(false);

	const name = $derived(firstName(shellState.account?.user));
	const part = $derived(dayPart());
	const reviewPick = $derived(pickToReview(items));
	const openPick = $derived(pickToOpen(items));
	const briefReady = $derived(openPrs.count !== null && !recentSessions.loading);

	/**
	 * Requests the AI brief once per app session; the server keeps it for 12 hours, so reviews finishing or
	 * PRs opening don't rewrite it. Returns the cleanup that aborts a request still in flight.
	 */
	function requestBrief(): (() => void) | undefined {
		if (!briefReady || openPrs.apiDown || needsModel || openPrs.briefRequested) return;
		if (items.length === 0) return;
		openPrs.briefRequested = true;

		const controller = new AbortController();

		briefLoading = true;
		briefFailed = false;

		serverApi
			.homeBrief(
				{
					name,
					dayPart: part,
					prs: items.map(({ pr, repo }) => ({
						repoId: repo.id,
						repo: repo.name,
						number: pr.number,
						title: pr.title,
						additions: pr.additions,
						deletions: pr.deletions,
						changedFiles: pr.changedFiles,
						createdAt: pr.createdAt
					})),
					emptyRepos: openPrs.repos
						.filter((repo) => (openPrs.prsByRepo[repo.id] ?? []).length === 0)
						.map((repo) => repo.name)
				},
				controller.signal
			)
			.then((brief) => {
				openPrs.setBrief(brief);
			})
			.catch(() => {
				if (!controller.signal.aborted) briefFailed = true;
			})
			.finally(() => {
				if (!controller.signal.aborted) briefLoading = false;
			});

		return () => {
			if (briefLoading) openPrs.briefRequested = false;
			controller.abort();
		};
	}

	$effect(() => requestBrief());

	/** The greeting is ours, for the current time of day; the brief body can be hours old. */
	const greeting = $derived(
		`**${{ morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Evening' }[part]}${name ? `, ${name}` : ''}.**`
	);

	const briefText = $derived(
		openPrs.brief && items.length > 0
			? `${greeting} ${openPrs.brief.text.replace(/^\**\s*(good\s+)?(morning|afternoon|evening|night)\b[^.!*]*[.!]\s*\**\s*/i, '')}`
			: briefReady
				? fallbackBrief(items, name, part)
				: null
	);

	/**
	 * A skeleton only until the PR list is in: after that the built-in summary shows at once, and the AI
	 * brief replaces it in place whenever (if ever) it arrives. It sits on the brief's 27px / 1.38 line box,
	 * so the page doesn't shift when the text lands.
	 */
	const showBriefSkeleton = $derived(!openPrs.brief && !briefReady);

	/**
	 * The brief split into text, emphasis and PR refs. The markup renders them on tight lines, since
	 * whitespace between those tags shows as stray spaces.
	 */
	const segments = $derived(briefText ? briefSegments(briefText) : []);

	const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

	const updatedAt = $derived(
		openPrs.brief && !briefFailed
			? new Date(openPrs.brief.generatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
			: null
	);
</script>

<section aria-label="Brief" class="flex flex-col">
	<Typography.Metadata class="flex items-center gap-2 text-[12.5px] text-fg-faint">
		<span class="font-medium text-fg-muted">Brief</span>
		<span aria-hidden="true">·</span>
		<span>{today}</span>
		{#if updatedAt}
			<span aria-hidden="true">·</span>
			<span>updated {updatedAt}</span>
		{/if}
	</Typography.Metadata>
	{#if showBriefSkeleton}
		<div class="mt-4 flex flex-col" role="status" aria-label="Writing the brief">
			<div class="flex h-[37px] items-center"><Skeleton class="h-[22px] w-[94%]" /></div>
			<div class="flex h-[37px] items-center"><Skeleton class="h-[22px] w-[58%]" /></div>
		</div>
	{:else if briefText}
		<div class="home-brief-stack">
			{#key briefText}
				<div class="home-brief-layer">
					<Typography.Text class="home-brief ai-voice">
						{#each segments as segment, i (i)}{#if segment.kind === 'strong'}<span class="text-fg">{segment.text}</span
								>{:else if segment.kind === 'pr' && items.some((item) => item.pr.number === segment.number)}{@const item =
									items.find((candidate) => candidate.pr.number === segment.number)!}<span class="brief-ref-wrap"
									><BriefPrRef {item} text={segment.text} {onOpen} /></span
								>{:else}{segment.text}{/if}{/each}
					</Typography.Text>
				</div>
			{/key}
		</div>
	{/if}
	{#if briefReady && (reviewPick || openPick)}
		<div class="mt-[22px] flex flex-wrap gap-2">
			{#if reviewPick}
				{@const pick = reviewPick}
				<Button
					class="brief-action"
					loading={starting === prKey(pick.repo.id, pick.pr.number)}
					onclick={() => onStart(pick.pr, pick.repo)}
				>
					<Play size={12} fill="currentColor" aria-hidden="true" />
					Review #{pick.pr.number}
				</Button>
			{/if}
			{#if openPick?.review}
				{@const pick = openPick}
				<Button variant="outline" class="brief-action" onclick={() => pick.review && onOpen(pick.review, pick.repo)}>
					Open #{pick.pr.number}
					<Badge variant="secondary" data-sev="high" class="severity-pill font-mono"
						>{highCount(pick.review)} high</Badge
					>
				</Button>
			{/if}
		</div>
	{/if}
</section>
