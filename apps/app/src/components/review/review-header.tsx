'use client';

import { Button, DURATION, EASE_OUT, Keycap, Spinner, swapMotion, Tooltip, useMotionVariants } from '@recoder/ui';
import { ArrowUpRight, Bot, GitBranch, MessageSquareText } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { PanelHeader } from '@/components/common/panel-header';
import { connectionNote } from '@/lib/live/live-progress';
import { useReview } from '@/lib/review/review-store';
import { author } from '@/lib/shell/format';

import { ReviewMenu } from './review-menu';
import { forgeName, pullTitle, useCounts, useLiveView, useShownReview } from './review-view';

/**
 * Repository, author, branch, head commit and size, once the pull request
 * lookup has answered. When the header runs short the meta gives way before
 * the title: the branch truncates, then the commit and author drop out.
 */
function HeaderMeta() {
	const review = useShownReview();
	const pull = useReview((state) => state.pull);
	const repoName = useReview((state) => state.repoName);
	const loaded = useReview((state) => state.pullLoaded);
	const who = pull ? author(pull.author) : null;
	const sha = review.headSha === 'unknown' ? null : review.headSha.slice(0, 7);

	return (
		<AnimatePresence initial={false}>
			{loaded ? (
				<motion.span
					className="review-meta"
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ duration: DURATION.swap, ease: EASE_OUT }}
				>
					{repoName ? <span>{repoName}</span> : null}
					{who ? (
						<span className="review-author" data-agent={who.agent || undefined}>
							{who.agent ? <Bot size={12} aria-label="Agent" /> : null}
							{who.name}
						</span>
					) : null}
					{pull ? (
						<span className="review-branch mono">
							<GitBranch size={12} aria-hidden />
							<span className="review-ref" title={pull.headRef}>
								{pull.headRef}
							</span>
							<span className="review-arrow">→</span>
							{pull.base}
						</span>
					) : null}
					{sha ? (
						<span className="review-sha mono" title={review.headSha}>
							{sha}
						</span>
					) : null}
					{pull ? (
						<span className="mono tabular">
							<span className="text-ok">+{pull.additions}</span> <span className="text-danger">−{pull.deletions}</span>
						</span>
					) : null}
				</motion.span>
			) : null}
		</AnimatePresence>
	);
}

/**
 * A quiet note while the live stream reconnects, in the live view's words.
 * The live progress view shows its own, so this one stands down there.
 */
function ConnectionNote() {
	const swap = useMotionVariants(swapMotion);
	const reconnecting = useReview((state) => state.connection === 'reconnecting');
	const live = useLiveView();

	return (
		<AnimatePresence initial={false}>
			{reconnecting && !live ? (
				<motion.span
					className="review-connection"
					role="status"
					variants={swap}
					initial="initial"
					animate="animate"
					exit="exit"
				>
					<Spinner size={11} />
					{connectionNote('reconnecting')}
				</motion.span>
			) : null}
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

/** The 44px review header: number, title, pull request facts, then the review's actions. */
export function ReviewHeader() {
	const review = useShownReview();
	const pull = useReview((state) => state.pull);
	const title = pullTitle(review, pull);
	const url = review.prUrl ?? pull?.url ?? null;

	return (
		<PanelHeader className="review-head gap-3 pr-2.5 pl-[18px]">
			<span className="review-pr mono">#{review.prNumber}</span>
			<h1 className="review-title truncate" title={title}>
				{title}
			</h1>
			<HeaderMeta />
			<span className="flex-1" />
			<div className="review-head-side">
				<ConnectionNote />
				<HandOff />
				<AskToggle />
				{url ? <OpenPull url={url} /> : null}
				<ReviewMenu />
			</div>
		</PanelHeader>
	);
}
