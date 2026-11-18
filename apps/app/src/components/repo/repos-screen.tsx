'use client';

import {
	Button,
	Card,
	DURATION,
	EASE_OUT,
	RowButton,
	SkeletonBox,
	StatusNotice,
	useEntrance,
	useMotionVariants,
	type EntranceProps
} from '@recoder/ui';
import { PlusIcon } from '@phosphor-icons/react';
import { AnimatePresence, motion, type Variants } from 'motion/react';

import type { FleetScope } from '@/lib/repo/fleet';
import { useReposPage, type ReposPageView } from '@/lib/repo/use-repos-page';

import { FindField } from '@/components/common/find-field';
import { Page } from '@/components/common/page';
import { PageTabs } from '@/components/common/page-tabs';
import { RepoBrowser } from '@/components/connections/repo-browser';
import { SectionNotice } from '@/components/settings/section-notice';

import { FleetTile } from './fleet-tile';

/** A tile fades out as its repository leaves the page, and in as one joins or Undo brings it back. */
const TILE: Variants = {
	gone: { opacity: 0, scale: 0.97, transition: { duration: DURATION.menuOut, ease: EASE_OUT } },
	shown: { opacity: 1, scale: 1, transition: { duration: DURATION.disclose, ease: EASE_OUT } }
};

/** How many placeholder tiles stand in while the tracked repositories load. */
const LOADING_TILES = 3;

/** What the page says with no tile to show: the filter text matched nothing, or nothing is under the scope. */
function emptyTitle(scope: FleetScope, query: string): string {
	if (query) return `No repository matches “${query}”`;
	if (scope === 'needs-you') return 'Nothing needs you';
	if (scope === 'quiet') return 'Every repository has something waiting';

	return 'Auto review watches every repository';
}

/** A tile's outline while the repositories load: a name, a figure, the bars and the last line. */
function TileSkeleton() {
	return (
		<Card className="fleet-tile" aria-hidden>
			<SkeletonBox className="h-[18px] w-[132px]" />
			<SkeletonBox className="fleet-figures-skeleton" />
			<SkeletonBox className="fleet-bars-skeleton" />
			<div className="fleet-foot">
				<SkeletonBox className="h-4 w-[210px]" />
			</div>
		</Card>
	);
}

/** The last tile: it opens the dialog that tracks another repository. */
function ConnectTile({ onConnect }: { onConnect: () => void }) {
	return (
		<div className="fleet-connect">
			<span className="fleet-connect-mark" aria-hidden>
				<PlusIcon />
			</span>
			<RowButton cover className="fleet-connect-name" onClick={onConnect}>
				Connect a repository
			</RowButton>
			<span className="fleet-connect-detail">From GitHub, GitLab, or a URL</span>
		</div>
	);
}

/** The scopes as tabs with how many repositories each holds, and the days the tiles cover. */
function FleetHead({ view }: { view: ReposPageView }) {
	const tabs = view.scopes.map((scope) => ({
		...scope,
		tone: scope.id === 'needs-you' ? ('bugs' as const) : undefined
	}));

	return (
		<div className="fleet-head">
			<PageTabs label="Repositories" tabs={tabs} current={view.scope} />
			{view.days === null ? null : <span className="fleet-window">Last {view.days} days</span>}
		</div>
	);
}

interface FleetGridProps {
	view: ReposPageView;
	/** The tiles' entrance, which only the page's first grid plays. */
	entrance: EntranceProps;
}

/**
 * The tiles in a grid. On the page's first reveal they rise in one after another; after that a repository that is
 * stopped fades before the others close the gap, one that is added or brought back by Undo fades in, and another
 * scope or other filter text swaps the grid at once, like any list.
 */
function FleetGrid({ view, entrance }: FleetGridProps) {
	const variants = useMotionVariants(TILE);
	const unfiltered = view.scope === 'all' && view.query.trim() === '';

	return (
		<div className="fleet-grid" {...entrance}>
			<AnimatePresence initial={false}>
				{view.tiles.map((tile) => (
					<motion.div
						key={tile.id}
						className="fleet-cell"
						variants={variants}
						initial="gone"
						animate="shown"
						exit="gone"
					>
						<FleetTile tile={tile} onStop={view.stop} onRetry={view.retryOverviews} />
					</motion.div>
				))}
			</AnimatePresence>
			{unfiltered ? <ConnectTile onConnect={() => view.setAdding(true)} /> : null}
		</div>
	);
}

/** The scopes over the tiles, or what the scope and the filter text leave to say with no tile to show. */
function Fleet({ view }: { view: ReposPageView }) {
	const entrance = useEntrance('stagger');
	const query = view.query.trim();
	const nothing = view.tiles.length === 0 && (view.scope !== 'all' || query !== '');

	return (
		<>
			{view.tracked > 0 ? <FleetHead view={view} /> : null}
			{nothing ? (
				<div className="page-notice">
					<StatusNotice variant="section" heading="h2" title={emptyTitle(view.scope, query)} />
				</div>
			) : (
				<FleetGrid key={`${view.scope}\n${view.query}`} view={view} entrance={entrance} />
			)}
		</>
	);
}

/**
 * Repositories: every tracked repository as a tile that opens its page, those with something to do first, under
 * scopes that narrow them. The bar filters by name and adds a repository from a signed-in forge or by URL.
 */
export function ReposScreen() {
	const view = useReposPage();

	return (
		<Page
			start={<h1 className="page-bar-title">Repositories</h1>}
			end={
				<>
					{view.tracked > 1 ? (
						<FindField
							className="fleet-find"
							label="Filter repositories"
							placeholder="Filter"
							query={view.query}
							onQueryChange={view.setQuery}
						/>
					) : null}
					<Button variant="primary" className="fleet-add" onClick={() => view.setAdding(true)}>
						<PlusIcon aria-hidden />
						Add repository
					</Button>
				</>
			}
		>
			<div className="page-scroll">
				<div className="fleet">
					{view.phase === 'loading' ? (
						<div className="fleet-grid">
							{Array.from({ length: LOADING_TILES }, (_, index) => (
								<TileSkeleton key={index} />
							))}
						</div>
					) : null}
					{view.phase === 'failed' ? (
						<SectionNotice what="Repositories" error={view.error} retry={{ status: 'idle', run: view.retry }} />
					) : null}
					{view.phase === 'ready' ? <Fleet view={view} /> : null}
				</div>
			</div>
			<RepoBrowser open={view.adding} onOpenChange={view.setAdding} />
		</Page>
	);
}
