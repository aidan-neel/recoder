'use client';

import {
	Button,
	CommandBar,
	CommandBarInput,
	CommandBarPanel,
	CommandEmpty,
	CommandFooter,
	CommandGroup,
	CommandList,
	Keycap,
	Spinner,
	Switch,
	swapMotion,
	useMotionVariants
} from '@recoder/ui';
import { CircleAlert, CircleCheck, GitPullRequestArrow, MessageSquareQuote } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';

import { openSettings } from '@/lib/settings/settings-url';
import { reviewHref } from '@/lib/shell/routes';

import { ReviewBarRow } from './review-bar-row';
import { useReviewBar, type BarStatus } from './use-review-bar';

const PLACEHOLDER = 'Review a pull request: paste a link, type #214, or search';

/** The way out a failure offers: the settings section that fixes it. */
function SettingsButton({ status }: { status: BarStatus }) {
	if (status.phase !== 'failed' || !status.section) return null;

	const section = status.section;

	return (
		<Button variant="outline" onClick={() => openSettings(section)}>
			{section === 'connections' ? 'Open connections' : 'Open settings'}
		</Button>
	);
}

/** The status's mark: a spinner while starting, a check once started, an alert when it failed. */
function StatusMark({ status }: { status: BarStatus }) {
	if (status.phase === 'pending') return <Spinner size={13} />;
	if (status.phase === 'done') return <CircleCheck aria-hidden className="size-[15px] text-ok" />;

	return <CircleAlert aria-hidden className="size-[15px] text-danger" />;
}

/**
 * The line under the closed bar: the start in flight, the one that just
 * began (with a way to open it), or the failure and its way out. It sits in
 * the gap above the list, so nothing below moves when it changes.
 */
function StatusLine({ status, hidden }: { status: BarStatus; hidden: boolean }) {
	const swap = useMotionVariants(swapMotion);
	const shown = status.phase !== 'idle' && !hidden;

	return (
		<div className="review-bar-status" role="status">
			<AnimatePresence initial={false} mode="popLayout">
				{shown ? (
					<motion.p
						key={`${status.phase}:${'text' in status ? status.text : ''}`}
						data-phase={status.phase}
						variants={swap}
						initial="initial"
						animate="animate"
						exit="exit"
					>
						<StatusMark status={status} />
						<span className="min-w-0 truncate">{'text' in status ? status.text : ''}</span>
						{status.phase === 'done' && status.reviewId ? (
							<Button asChild variant="ghost">
								<Link href={reviewHref(status.reviewId)}>Open review</Link>
							</Button>
						) : null}
						<SettingsButton status={status} />
					</motion.p>
				) : null}
			</AnimatePresence>
		</div>
	);
}

/** A failure while the bar is open, above its rows, so the person can fix the text and try again. */
function FailureNotice({ status }: { status: BarStatus }) {
	if (status.phase !== 'failed') return null;

	return (
		<div className="review-bar-notice" role="alert">
			<CircleAlert aria-hidden className="size-[15px] shrink-0 text-danger" />
			<span className="min-w-0 flex-1">{status.text}</span>
			<SettingsButton status={status} />
		</div>
	);
}

/** The brief the review will run with, as the bar read it from the text after the reference. */
function BriefLine({ brief }: { brief: string }) {
	if (!brief) return null;

	return (
		<div className="review-bar-brief">
			<MessageSquareQuote aria-hidden className="size-[15px] shrink-0" />
			<span className="shrink-0 text-fg-faint">Brief</span>
			<span className="min-w-0 truncate text-fg-secondary">{brief}</span>
		</div>
	);
}

/** The footer's switch: every review the bar starts posts a summary comment on the pull request. */
function CommentSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
	return (
		<label className="review-bar-comment">
			Comment on the PR
			<Switch checked={on} onCheckedChange={onChange} />
		</label>
	);
}

/**
 * The queue's review bar, under the headline: the fastest way to start or
 * steer a review. It takes a pull request link, a short reference (`#214`,
 * `api#214`, GitLab's `!214`) with an optional brief after it, or words that
 * search the open pull requests. `/` focuses it and Escape leaves it; the ⌘K
 * palette stays the way to go places.
 */
export function ReviewBar({ sample }: { sample: boolean }) {
	const bar = useReviewBar(sample);
	const pendingId = bar.status.phase === 'pending' ? bar.status.id : null;

	return (
		<div className="review-bar">
			<CommandBar
				label="Review a pull request"
				value={bar.highlighted}
				onValueChange={bar.setHighlighted}
				shouldFilter={false}
				onKeyDown={bar.onKeyDown}
				onFocusChange={bar.onFocusChange}
			>
				<CommandBarInput
					inputRef={bar.inputRef}
					placeholder={PLACEHOLDER}
					value={bar.text}
					onValueChange={bar.change}
					leading={<GitPullRequestArrow aria-hidden className="size-4 shrink-0 text-fg-muted" />}
					trailing={bar.open ? null : <Keycap k="/" />}
				/>
				<CommandBarPanel open={bar.open}>
					<FailureNotice status={bar.status} />
					<BriefLine brief={bar.query.brief} />
					<CommandList>
						{bar.groups.map((group) => (
							<CommandGroup key={group.heading} heading={group.heading}>
								{group.items.map((item) => (
									<ReviewBarRow
										key={item.id}
										item={item}
										actions={bar.actionsFor(item)}
										pending={item.id === pendingId}
										onRun={() => bar.run(item)}
									/>
								))}
							</CommandGroup>
						))}
						<CommandEmpty>{bar.empty}</CommandEmpty>
					</CommandList>
					<CommandFooter
						hints={bar.hints}
						aside={sample ? null : <CommentSwitch on={bar.comment} onChange={bar.setComment} />}
					/>
				</CommandBarPanel>
			</CommandBar>
			<StatusLine status={bar.status} hidden={bar.open} />
		</div>
	);
}
