'use client';

import { Button, DURATION, EASE_OUT, Keycap, Spinner, swapMotion, Tooltip, useMotionVariants } from '@recoder/ui';
import { ArrowUpRight, Bot, GitBranch, MessageSquareText } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { PanelHeader } from '@/components/common/panel-header';
import { connectionNote } from '@/lib/live/live-progress';
import { listTime } from '@/lib/queue/format';
import { useReview, type ReviewStore } from '@/lib/review/review-store';
import { author } from '@/lib/shell/format';
import { useAction } from '@/lib/shell/use-action';

import { ReviewMenu } from './review-menu';
import { forgeName, pullTitle, useCounts, useLiveView, useShownReview } from './review-view';

/** Lines added and removed: from the diff, which the page paints with, else from the pull request. */
function diffSize(state: Pick<ReviewStore, 'files' | 'pull'>): [number, number] | null {
	if (state.files.length === 0) return state.pull ? [state.pull.additions, state.pull.deletions] : null;

	return state.files.reduce<[number, number]>(
		(sum, file) => [sum[0] + file.additions, sum[1] + file.deletions],
		[0, 0]
	);
}

/**
 * Where the header shows the repository's name: first in the meta when the
 * page knew it as the header first drew, else at the end of what was there
 * when the name came in, before the pull request's facts or after them.
 */
type RepoSlot = 'first' | 'before-pull' | 'after-pull';

/** The slot the name has for review `id`, decided once per review; null while there is no name. */
interface PlacedRepo {
	id: string;
	slot: RepoSlot | null;
}

/**
 * Where the repository's name goes. A name the page knew as the header first
 * drew leads the meta. One that comes later (the list of names answered
 * after the page painted) goes where its arrival moves nothing: after the
 * meta, or after the pull request's facts when those are already on screen.
 */
function useRepoSlot(): RepoSlot | null {
	const id = useReview((state) => state.id);
	const named = useReview((state) => state.repoName !== null);
	const pullShown = useReview((state) => state.pull !== null);
	const [placed, setPlaced] = useState<PlacedRepo>({ id, slot: named ? 'first' : null });

	if (placed.id !== id) {
		setPlaced({ id, slot: named ? 'first' : null });

		return named ? 'first' : null;
	}

	if (named && placed.slot === null) {
		const slot = pullShown ? 'after-pull' : 'before-pull';

		setPlaced({ id, slot });

		return slot;
	}

	return named ? placed.slot : null;
}

/**
 * Repository, head commit and size. The review and its diff carry the
 * commit and size, so they paint with the page, as does the repository's
 * name when the page knows it by then (`named`). When the header runs short
 * the commit drops out first; the title keeps its room.
 */
function HeaderMeta({ named }: { named: boolean }) {
	const review = useShownReview();
	const repoName = useReview((state) => state.repoName);
	const size = useReview(useShallow(diffSize));
	const sha = review.headSha === 'unknown' ? null : review.headSha.slice(0, 7);

	return (
		<span className="review-meta">
			{named && repoName ? <span>{repoName}</span> : null}
			{sha ? (
				<span className="review-sha mono" title={review.headSha}>
					{sha}
				</span>
			) : null}
			{size ? (
				<span className="mono tabular">
					<span className="text-ok">+{size[0]}</span> <span className="text-danger">−{size[1]}</span>
				</span>
			) : null}
		</span>
	);
}

/**
 * Author and branch, from the pull request lookup. They sit at the end of
 * the meta and give way before anything else, so a lookup that answers after
 * the page painted fades them in without moving the title or the rest. Each
 * drops whole when it has no room; the branch first cuts its name to a few
 * letters (review-head.css).
 */
function PullMeta() {
	const pull = useReview((state) => state.pull);
	const who = pull ? author(pull.author) : null;

	return (
		<AnimatePresence initial={false}>
			{pull ? (
				<motion.span
					key="pull"
					className="review-meta review-meta-pull"
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ duration: DURATION.swap, ease: EASE_OUT }}
				>
					{who ? (
						<span className="review-author" data-agent={who.agent || undefined}>
							{who.agent ? <Bot size={12} aria-label="Agent" /> : null}
							{who.name}
						</span>
					) : null}
					<span className="review-branch mono">
						<GitBranch size={12} aria-hidden />
						<span className="review-ref" title={pull.headRef}>
							{pull.headRef}
						</span>
						<span className="review-arrow">→</span>
						{pull.base}
					</span>
				</motion.span>
			) : null}
		</AnimatePresence>
	);
}

/**
 * The repository's name when it came in after the header drew. It sits last
 * at that moment, after the meta or the pull request's facts, and fades in,
 * so its arrival moves nothing; like those facts, it gives way first when
 * the header runs short (review-head.css).
 */
function LateRepo() {
	const repoName = useReview((state) => state.repoName);

	return (
		<motion.span
			className="review-meta review-meta-pull"
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			transition={{ duration: DURATION.swap, ease: EASE_OUT }}
		>
			<span>{repoName}</span>
		</motion.span>
	);
}

/** Failed attempts in a row after which the reconnecting note offers Try again. */
const OFFER_AFTER = 2;

/** The longest Try again waits for the stream to open before it shows its failure face. */
const RECONNECT_WAIT_MS = 10_000;

/**
 * Reconnects the live stream now; resolves once it is live again, and
 * rejects when the attempt fails, the page leaves, or nothing is settled in
 * time, so the button shows its failure face. It watches the store only
 * after the reconnect has set the count of failures back to 0, so the
 * failures before it never count against it.
 */
function reconnectNow(): Promise<void> {
	useReview.getState().reconnect();

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => finish(new Error('The stream did not open in time.')), RECONNECT_WAIT_MS);

		const unsubscribe = useReview.subscribe((state) => {
			if (state.connection === 'live') finish(null);
			else if (state.connection === 'closed' || state.streamFailures > 0) finish(new Error('The stream did not open.'));
		});

		function finish(error: Error | null): void {
			clearTimeout(timer);
			unsubscribe();

			if (error) reject(error);
			else resolve();
		}
	});
}

/**
 * A quiet note while the live stream reconnects, in the live view's words.
 * After the second failed attempt in a row it offers Try again, which
 * reconnects at once rather than wait out the backoff (up to 30s). The
 * button's room is held from the start and it fades in, so its arrival
 * moves nothing; once offered it stays while the note does.
 */
function ConnectionNote() {
	const swap = useMotionVariants(swapMotion);
	const retry = useAction();
	const failing = useReview((state) => state.streamFailures >= OFFER_AFTER);
	const [offered, setOffered] = useState(failing);

	if (failing && !offered) setOffered(true);

	const shown = offered || failing;

	return (
		<motion.span className="review-connection" variants={swap} initial="initial" animate="animate" exit="exit">
			<Spinner size={11} />
			<span role="status">{connectionNote('reconnecting')}</span>
			<motion.span variants={swap} initial={false} animate={shown ? 'animate' : 'initial'} inert={!shown}>
				<Button variant="ghost" status={retry.status} onClick={() => retry.run(reconnectNow)}>
					Try again
				</Button>
			</motion.span>
		</motion.span>
	);
}

/** Reads the review again; rejects while it still cannot, so the button shows its failure face. */
async function refreshAgain(): Promise<void> {
	await useReview.getState().refresh();

	if (useReview.getState().staleSince !== null) throw new Error('The review is still not refreshed.');
}

/**
 * A quiet note while the copy on screen could not be brought up to date (a
 * return visit, or a refresh, with the server down or slow): when it was
 * last current (`since`, 0 when unknown), which a short header leaves out,
 * and Try again. The next answer from the server clears it.
 */
function StaleNote({ since }: { since: number }) {
	const swap = useMotionVariants(swapMotion);
	const retry = useAction();

	return (
		<motion.span
			data-ui="review-stale"
			className="review-stale"
			variants={swap}
			initial="initial"
			animate="animate"
			exit="exit"
		>
			<span role="status">
				{since ? (
					<>
						Not refreshed<span className="review-stale-since"> since {listTime(since)}</span>
					</>
				) : (
					'Couldn’t refresh'
				)}
			</span>
			<Button variant="ghost" status={retry.status} onClick={() => retry.run(refreshAgain)}>
				Try again
			</Button>
		</motion.span>
	);
}

/**
 * The header's note, one at a time: the stale note, which says more, else
 * the reconnecting note while the live stream reconnects. The live progress
 * view shows its own reconnecting note, so this one stands down there. A
 * note that goes leaves before the next comes, so the two never share the
 * room, and the next comes only if it still applies by then.
 */
function HeaderNote() {
	const since = useReview((state) => state.staleSince);
	const reconnecting = useReview((state) => state.connection === 'reconnecting');
	const live = useLiveView();
	const connection = reconnecting && !live ? <ConnectionNote key="connection" /> : null;

	return (
		<AnimatePresence initial={false} mode="wait">
			{since === null ? connection : <StaleNote key="stale" since={since} />}
		</AnimatePresence>
	);
}

/** Hand off, once anything was sent back. An outline button, since the verdict and the decision bar hold the filled one. */
function HandOff() {
	const swap = useMotionVariants(swapMotion);
	const { sent } = useCounts();
	const setHandoffOpen = useReview((state) => state.setHandoffOpen);

	return (
		<AnimatePresence initial={false}>
			{sent > 0 ? (
				<motion.span className="flex" variants={swap} initial="initial" animate="animate" exit="exit">
					<Button variant="outline" aria-label="Hand off" aria-keyshortcuts="H" onClick={() => setHandoffOpen(true)}>
						Hand off <Keycap k="h" />
					</Button>
				</motion.span>
			) : null}
		</AnimatePresence>
	);
}

/**
 * Opens or closes the ask column from any selection. On a decision or a
 * receipt it asks that item's reviewer; on the overview or a file it is the
 * conversation with Orchestrator, which the sample does not have.
 */
function AskToggle() {
	const open = useReview((state) => state.askOpen);
	const setAskOpen = useReview((state) => state.setAskOpen);

	const reviewer = useReview(
		(state) => state.sample || state.selection.kind === 'decision' || state.selection.kind === 'receipt'
	);

	const label = open ? 'Close' : reviewer ? 'Ask the reviewer' : 'Ask Orchestrator';

	return (
		<Tooltip content={label} shortcut="q" side="bottom">
			<Button
				variant="ghost"
				size="icon"
				aria-label={open ? 'Close ask' : label}
				aria-keyshortcuts="Q"
				aria-expanded={open}
				data-state={open ? 'open' : 'closed'}
				onClick={() => setAskOpen(!open)}
			>
				<MessageSquareText />
			</Button>
		</Tooltip>
	);
}

/** The pull request on its forge, named for the forge it lives on. */
function OpenPull({ url }: { url: string }) {
	const forge = forgeName(useShownReview());
	const label = forge ? `Open on ${forge}` : 'Open pull request';

	return (
		<Tooltip content={label} side="bottom">
			<Button variant="ghost" size="icon" asChild>
				<a href={url} target="_blank" rel="noreferrer" aria-label={label}>
					<ArrowUpRight />
				</a>
			</Button>
		</Tooltip>
	);
}

/**
 * The 44px review header: number, title, pull request facts, the notes, then
 * the review's actions. The notes take only the room the rest leaves, so one
 * that appears never moves the title or the meta, and one that does not fit
 * stays out of sight (review.css).
 */
export function ReviewHeader() {
	const review = useShownReview();
	const pull = useReview((state) => state.pull);
	const title = pullTitle(review, pull);
	const url = review.prUrl ?? pull?.url ?? null;
	const repoSlot = useRepoSlot();

	return (
		<PanelHeader className="review-head gap-3 pr-2.5 pl-[18px]">
			<span className="review-pr mono">#{review.prNumber}</span>
			<h1 className="review-title truncate" title={title}>
				{title}
			</h1>
			<HeaderMeta named={repoSlot === 'first'} />
			{repoSlot === 'before-pull' ? <LateRepo /> : null}
			<PullMeta />
			{repoSlot === 'after-pull' ? <LateRepo /> : null}
			<span className="review-head-notes">
				<HeaderNote />
			</span>
			<div className="review-head-side">
				<HandOff />
				<AskToggle />
				{url ? <OpenPull url={url} /> : null}
				<ReviewMenu />
			</div>
		</PanelHeader>
	);
}
