<script lang="ts">
	import Play from '@lucide/svelte/icons/play';
	import { briefSnapshotKey, repoLabels, type PullRequest, type Repo, type Review } from '@recoder/shared';
	import { Badge } from '@sivir-ui/svelte/components/badge';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import { serverApi } from '$lib/api/server-api';
	import Skeleton from '$lib/components/ui/skeleton.svelte';
	import {
		actionPrLabel,
		briefActions,
		briefSegments,
		dayPart,
		fallbackBrief,
		firstName,
		highCount,
		prKey,
		toBriefPrs,
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

	let briefFailed = $state(false);

	const name = $derived(firstName(shellState.account?.user));
	const part = $derived(dayPart());
	const labels = $derived(repoLabels(openPrs.repos.length > 0 ? openPrs.repos : items.map((item) => item.repo)));
	const briefPrs = $derived(toBriefPrs(items, labels));
	const currentSnapshot = $derived(briefSnapshotKey(briefPrs));
	const briefReady = $derived(openPrs.count !== null && !recentSessions.loading);

	/**
	 * Requests the AI brief whenever the open pull request snapshot (`repoId#number@headSha`)
	 * changes; aborts an older in-flight call if the snapshot moves on before it returns.
	 */
	function requestBrief(): (() => void) | undefined {
		if (!briefReady || openPrs.apiDown || needsModel) return;

		if (items.length === 0) {
			openPrs.briefRequestedSnapshot = null;
			openPrs.setBrief(null);

			return;
		}

		const snapshot = currentSnapshot;

		if (openPrs.briefRequestedSnapshot === snapshot) return;
		openPrs.briefRequestedSnapshot = snapshot;

		const controller = new AbortController();
		let pending = true;

		briefFailed = false;

		serverApi
			.homeBrief(
				{
					name,
					dayPart: part,
					prs: briefPrs,
					emptyRepos: openPrs.repos
						.filter((repo) => (openPrs.prsByRepo[repo.id] ?? []).length === 0)
						.map((repo) => labels.get(repo.id) ?? repo.name)
				},
				controller.signal
			)
			.then((brief) => {
				if (!controller.signal.aborted && brief.snapshot === snapshot) {
					openPrs.setBrief(brief);
				}
			})
			.catch(() => {
				if (!controller.signal.aborted) briefFailed = true;
			})
			.finally(() => {
				pending = false;
			});

		return () => {
			if (pending && openPrs.briefRequestedSnapshot === snapshot) {
				openPrs.briefRequestedSnapshot = null;
			}

			controller.abort();
		};
	}

	$effect(() => requestBrief());

	const activeBrief = $derived(
		openPrs.brief && items.length > 0 && openPrs.brief.snapshot === currentSnapshot ? openPrs.brief : null
	);

	const fallback = $derived(briefReady ? fallbackBrief(items, name, part, labels) : null);

	/** The greeting is ours, for the current time of day; the brief body can be hours old. */
	const greeting = $derived(
		`**${{ morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Evening' }[part]}${name ? `, ${name}` : ''}.**`
	);

	const briefText = $derived(
		activeBrief
			? `${greeting} ${activeBrief.text.replace(/^\**\s*(good\s+)?(morning|afternoon|evening|night)\b[^.!*]*[.!]\s*\**\s*/i, '')}`
			: (fallback?.text ?? null)
	);

	const activeRefs = $derived(activeBrief ? activeBrief.refs : (fallback?.refs ?? []));
	const actions = $derived(briefActions(items, activeRefs));
	const reviewPick = $derived(actions.reviewPick);
	const openPick = $derived(actions.openPick);
	const reviewLabel = $derived(reviewPick ? actionPrLabel(reviewPick, items, labels) : '');
	const openLabel = $derived(openPick ? actionPrLabel(openPick, items, labels) : '');

	/**
	 * A skeleton only until the PR list is in: after that the built-in summary shows at once, and the AI
	 * brief replaces it in place whenever (if ever) it arrives. It sits on the brief's 27px / 1.38 line box,
	 * so the page doesn't shift when the text lands.
	 */
	const showBriefSkeleton = $derived(!activeBrief && !briefReady);

	/**
	 * The brief split into text, emphasis and PR refs. The markup renders them on tight lines, since
	 * whitespace between those tags shows as stray spaces.
	 */
	const segments = $derived(briefText ? briefSegments(briefText, activeRefs, items) : []);

	const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

	const updatedAt = $derived(
		activeBrief && !briefFailed
			? new Date(activeBrief.generatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
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
								>{:else if segment.kind === 'pr' && segment.item}{@const item = segment.item}<span
									class="brief-ref-wrap"><BriefPrRef {item} text={segment.text} {onOpen} /></span
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
					Review {reviewLabel}
				</Button>
			{/if}
			{#if openPick?.review}
				{@const pick = openPick}
				<Button variant="outline" class="brief-action" onclick={() => pick.review && onOpen(pick.review, pick.repo)}>
					Open {openLabel}
					<Badge variant="secondary" data-sev="high" class="severity-pill font-mono"
						>{highCount(pick.review)} high</Badge
					>
				</Button>
			{/if}
		</div>
	{/if}
</section>
