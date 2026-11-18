'use client';

import {
	Button,
	Card,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	ForgeMark,
	Pill,
	RowButton,
	Skeleton,
	Tooltip
} from '@recoder/ui';
import { CircleMinus, Ellipsis } from 'lucide-react';
import Link from 'next/link';

import { useApi } from '@/lib/api/client';
import type { PullRowStatus } from '@/lib/pulls/types';
import type { FleetFoot, FleetSecond, FleetTile as FleetTileView } from '@/lib/repo/fleet';
import { plural } from '@/lib/shell/format';
import { AUTOMATIONS_HREF, isLiveApp } from '@/lib/shell/routes';

import { Age } from '@/components/common/age';
import { StatusPill } from '@/components/pulls/pull-status';

import { ReviewBar } from './review-bar';

interface FleetTileProps {
	tile: FleetTileView;
	onStop: (tile: FleetTileView) => void;
	/** Reads again the overviews that did not load. */
	onRetry: () => void;
}

/** Whether auto review watches the repository, as a dot that says so when pointed at. Nothing until that is known. */
function AutoReviewDot({ overview }: Pick<FleetTileView, 'overview'>) {
	if (overview.phase !== 'ready') return null;

	const label = overview.autoReview ? 'Auto review on' : 'Auto review off';

	return (
		<Tooltip content={label}>
			<span className="fleet-dot" data-on={overview.autoReview || undefined} role="img" aria-label={label} />
		</Tooltip>
	);
}

/** What else the tile does, behind a button that waits until the tile is pointed at or focused. */
function TileMenu({ tile, onStop }: Pick<FleetTileProps, 'tile' | 'onStop'>) {
	return (
		<span className="fleet-menu">
			<DropdownMenu>
				<DropdownMenuTrigger>
					<Button variant="ghost" size="icon" aria-label={`More for ${tile.name}`}>
						<Ellipsis />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem icon={<CircleMinus />} onSelect={() => onStop(tile)}>
						Stop tracking
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</span>
	);
}

/** The fact after the open count: what waits for a review, or what merged when nothing is open. */
function SecondFact({ second }: { second: FleetSecond }) {
	if (second.kind === 'none-waiting') return <span className="fleet-fact">Nothing waiting</span>;

	return (
		<span className="fleet-fact">
			<span className="fleet-fact-number">{second.count}</span>
			{second.kind === 'waiting' ? ' waiting' : ` merged in ${second.days} days`}
		</span>
	);
}

/** The open bugs across the repository, the high ones in their colour; "No bugs" once a review came back clean. */
function BugFact({ tile }: Pick<FleetTileProps, 'tile'>) {
	if (tile.bugs) {
		return (
			<span className="fleet-fact" data-tone={tile.bugs.high ? 'high' : 'plain'}>
				{plural(tile.bugs.count, tile.bugs.high ? 'high bug' : 'bug')}
			</span>
		);
	}

	return tile.clean ? (
		<span className="fleet-fact" data-tone="ok">
			No bugs
		</span>
	) : null;
}

/** The tile's figures on one baseline: its open pull requests large, then what waits and what the reviews found. */
function Figures({ tile }: Pick<FleetTileProps, 'tile'>) {
	if (tile.open === null) return <Skeleton className="fleet-figures-skeleton" />;

	return (
		<p className="fleet-figures tabular">
			<span className="fleet-fact">
				<span className="fleet-count" data-zero={tile.open === 0 || undefined}>
					{tile.open}
				</span>{' '}
				open
			</span>
			{tile.second ? <SecondFact second={tile.second} /> : null}
			<BugFact tile={tile} />
		</p>
	);
}

/** The repository's reviews a day over the window, as the repository page charts them, small. */
function Activity({ tile, onRetry }: Pick<FleetTileProps, 'tile' | 'onRetry'>) {
	const { overview } = tile;

	if (overview.phase === 'loading') return <Skeleton className="fleet-bars-skeleton" />;

	if (overview.phase === 'failed') {
		return (
			<p className="fleet-bars-failed">
				Reviews didn’t load
				<Button variant="ghost" onClick={onRetry}>
					Try again
				</Button>
			</p>
		);
	}

	return (
		<div className="repo-chart fleet-bars" role="img" aria-label={overview.chart.summary}>
			{overview.chart.bars.map((bar) => (
				<ReviewBar key={bar.day} bar={bar} />
			))}
		</div>
	);
}

/**
 * The status of the pull request the tile names. The two that ask for a review say so; the rest wear the list's
 * pill, with bugs counted alone so the title keeps its room.
 */
function NextStatus({ status }: { status: PullRowStatus }) {
	if (status.kind === 'not-reviewed') return <Pill>No review</Pill>;
	if (status.kind === 'outdated') return <Pill>New commits</Pill>;
	if (status.kind === 'bugs' && status.bugs > 0) return <StatusPill status={{ ...status, suggestions: 0 }} />;

	return <StatusPill status={status} />;
}

/** Auto review skips the repository; on the real app the line leads to where it is switched. */
function AutoOffFoot() {
	const live = isLiveApp(useApi().base);

	return (
		<>
			<span className="fleet-foot-text">Auto review is off here</span>
			{live ? (
				<Button asChild variant="ghost" className="fleet-foot-action">
					<Link href={AUTOMATIONS_HREF}>Automations</Link>
				</Button>
			) : null}
		</>
	);
}

/** The tile's last line, under a hairline: the pull request to open next, or why there is none to name. */
function Foot({ foot }: { foot: FleetFoot }) {
	if (foot.kind === 'auto-off') return <AutoOffFoot />;

	if (foot.kind === 'caught-up') {
		return (
			<>
				<span className="fleet-foot-text">All caught up</span>
				<span className="fleet-foot-aside">
					{foot.lastReviewAt ? (
						<>
							Last review <Age at={foot.lastReviewAt} form="long" />
						</>
					) : (
						'No reviews yet'
					)}
				</span>
			</>
		);
	}

	return (
		<RowButton asChild className="fleet-next">
			<Link href={foot.row.href} prefetch={false}>
				<span className="fleet-next-number">#{foot.row.number}</span>
				<span className="fleet-next-title">{foot.row.title}</span>
				<NextStatus status={foot.row.status} />
			</Link>
		</RowButton>
	);
}

/**
 * One tracked repository: its name opens its page from anywhere on the tile, over its open pull requests, a bar a
 * day of its reviews, and the pull request to look at next, which is its own link.
 */
export function FleetTile({ tile, onStop, onRetry }: FleetTileProps) {
	return (
		<Card as="article" className="fleet-tile">
			<header className="fleet-tile-head">
				<ForgeMark provider={tile.provider} />
				<RowButton asChild cover className="fleet-tile-name">
					<Link href={tile.href} prefetch>
						{tile.owner ? (
							<>
								<span className="fleet-tile-owner">{tile.owner}</span>
								<span className="fleet-tile-slash"> / </span>
							</>
						) : null}
						<span className="fleet-tile-repo">{tile.name}</span>
					</Link>
				</RowButton>
				<TileMenu tile={tile} onStop={onStop} />
				<AutoReviewDot overview={tile.overview} />
			</header>
			<Figures tile={tile} />
			<Activity tile={tile} onRetry={onRetry} />
			<footer className="fleet-foot">
				<Foot foot={tile.foot} />
			</footer>
		</Card>
	);
}
