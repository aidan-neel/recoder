'use client';

import { Button, Card, DURATION, EASE_OUT, SkeletonRows, useMotionVariants } from '@recoder/ui';
import { Plus } from 'lucide-react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { useReposPage, type RepoListRow } from '@/lib/repo/use-repos-page';

import { ForgeTile } from '@/components/common/forge-tile';
import { RepoBrowser } from '@/components/connections/repo-browser';
import { SectionNotice } from '@/components/settings/section-notice';
import { SettingsRow } from '@/components/settings/settings-group';
import { SettingsPage } from '@/components/settings/settings-page';
import { SETTINGS_ROW_HEIGHT } from '@/components/settings/settings-skeleton';

/** A row folds away as it leaves the list and unfolds as it joins or Undo brings it back; the rows under it follow. */
const FOLD: Variants = {
	folded: { height: 0, opacity: 0, transition: { duration: DURATION.disclose, ease: EASE_OUT } },
	open: { height: 'auto', opacity: 1, transition: { duration: DURATION.disclose, ease: EASE_OUT } }
};

/** Widths for the name and detail bars of a loading row, so the rows do not look stamped. */
const SKELETON_WIDTHS = [
	['132px', '240px'],
	['104px', '210px'],
	['150px', '260px']
] as const;

/** One item of the list, folding in and out. */
function Fold({ children }: { children: ReactNode }) {
	const variants = useMotionVariants(FOLD);

	return (
		<motion.div className="repo-fold" variants={variants} initial="folded" animate="open" exit="folded">
			{children}
		</motion.div>
	);
}

/** The line under a repository's name: where it lives, its default branch, and its open pull requests. */
function RepoDetail({ row }: { row: RepoListRow }) {
	return (
		<>
			{row.place}
			<span className="meta-sep mono">{row.defaultBranch}</span>
			{row.open === null ? null : <span className="meta-sep tabular">{row.open} open</span>}
		</>
	);
}

/** A tracked repository: its name opens its page, and Stop tracking takes it off the list with Undo. */
function RepoRow({ row, onStop }: { row: RepoListRow; onStop: (row: RepoListRow) => void }) {
	return (
		<SettingsRow
			leading={<ForgeTile provider={row.provider} />}
			name={
				<Link href={row.href} prefetch className="repos-name">
					{row.owner ? <span className="repos-owner">{row.owner} / </span> : null}
					{row.name}
					{row.alert ? <span className="repos-alert" role="img" aria-label="Has high-severity bugs" /> : null}
				</Link>
			}
			detail={<RepoDetail row={row} />}
		>
			<Button variant="ghost" aria-label={`Stop tracking ${row.name}`} onClick={() => onStop(row)}>
				Stop tracking
			</Button>
		</SettingsRow>
	);
}

/** Every tracked repository by name, or what to do with none. */
function RepoList({ rows, onStop }: { rows: RepoListRow[]; onStop: (row: RepoListRow) => void }) {
	return (
		<Card>
			<AnimatePresence initial={false}>
				{rows.length === 0 ? (
					<Fold key="empty">
						<SettingsRow name="No repositories yet" detail="Add one to see its pull requests and review them here." />
					</Fold>
				) : (
					rows.map((row) => (
						<Fold key={row.id}>
							<RepoRow row={row} onStop={onStop} />
						</Fold>
					))
				)}
			</AnimatePresence>
		</Card>
	);
}

/**
 * Repositories: every tracked repository, each opening its page, with Add repository in the bar to track more from a
 * signed-in forge or by URL, and Stop tracking on each row.
 */
export function ReposScreen() {
	const view = useReposPage();

	return (
		<SettingsPage
			name="Repositories"
			end={
				<Button variant="primary" onClick={() => view.setAdding(true)}>
					<Plus aria-hidden />
					Add repository
				</Button>
			}
		>
			{view.phase === 'loading' ? (
				<Card aria-hidden>
					<SkeletonRows count={3} height={SETTINGS_ROW_HEIGHT} widths={SKELETON_WIDTHS} rowClassName="settings-row" />
				</Card>
			) : null}
			{view.phase === 'failed' ? (
				<SectionNotice what="Repositories" error={view.error} retry={{ status: 'idle', run: view.retry }} />
			) : null}
			{view.phase === 'ready' ? <RepoList rows={view.rows} onStop={view.stop} /> : null}
			<RepoBrowser open={view.adding} onOpenChange={view.setAdding} />
		</SettingsPage>
	);
}
