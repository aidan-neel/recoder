'use client';

import type { Repo } from '@recoder/shared';
import { Button, DURATION, EASE_OUT, useMotionVariants } from '@recoder/ui';
import { Plus } from 'lucide-react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { useRef, type ReactNode, type RefObject } from 'react';

import { ForgeTile } from '@/components/common/forge-tile';
import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';
import { repoPlace } from '@/lib/connections/repo-place';
import { stopTracking } from '@/lib/connections/stop-tracking';

/** A row folds away as it leaves the list and unfolds as it joins or Undo brings it back; the rows under it follow. */
const FOLD: Variants = {
	folded: { height: 0, opacity: 0, transition: { duration: DURATION.disclose, ease: EASE_OUT } },
	open: { height: 'auto', opacity: 1, transition: { duration: DURATION.disclose, ease: EASE_OUT } }
};

interface FoldProps {
	/** The tracked repository's id, so keyboard focus can find the row. */
	repoId?: string;
	children: ReactNode;
}

/** One item of the list, folding in and out. */
function Fold({ repoId, children }: FoldProps) {
	const variants = useMotionVariants(FOLD);

	return (
		<motion.div
			className="repo-fold"
			data-repo={repoId}
			variants={variants}
			initial="folded"
			animate="open"
			exit="folded"
		>
			{children}
		</motion.div>
	);
}

/** The repository whose row takes over a removed row's place in the tab order: the next one, else the one before. */
function neighborOf(repos: Repo[], repo: Repo): Repo | null {
	const index = repos.findIndex((item) => item.id === repo.id);

	return repos[index + 1] ?? repos[index - 1] ?? null;
}

interface FocusHandoff {
	/** The Add repository button, which takes focus when the last row leaves. */
	add: RefObject<HTMLButtonElement | null>;
	/** Call as a row is removed, with the button that removed it. */
	leaving: (repo: Repo, button: HTMLButtonElement) => void;
	/** Call once the removed row has folded away. */
	settle: () => void;
}

/**
 * Hands keyboard focus on once a removed row has folded away: to the
 * neighbor's Stop tracking button, or to Add repository when the list is
 * empty. Only a removal made from the keyboard moves focus; a click leaves it.
 */
function useFocusHandoff(repos: Repo[]): FocusHandoff {
	const add = useRef<HTMLButtonElement | null>(null);
	const next = useRef<string | null>(null);

	function leaving(repo: Repo, button: HTMLButtonElement): void {
		if (button.matches(':focus-visible')) next.current = neighborOf(repos, repo)?.id ?? '';
	}

	function settle(): void {
		const id = next.current;

		next.current = null;

		if (id === null) return;

		const target = id ? document.querySelector<HTMLElement>(`[data-repo="${CSS.escape(id)}"] button`) : add.current;

		target?.focus();
	}

	return { add, leaving, settle };
}

interface RepoRowProps {
	repo: Repo;
	onStop: (repo: Repo, button: HTMLButtonElement) => void;
}

/** A tracked repository: where it lives, its default branch, and Stop tracking. */
function RepoRow({ repo, onStop }: RepoRowProps) {
	return (
		<SettingsRow
			leading={<ForgeTile provider={repo.provider} />}
			name={repo.name}
			detail={
				<>
					{repoPlace(repo)}
					{repo.defaultBranch ? <span className="meta-sep mono">{repo.defaultBranch}</span> : null}
				</>
			}
		>
			<Button
				variant="ghost"
				aria-label={`Stop tracking ${repo.name}`}
				onClick={(event) => onStop(repo, event.currentTarget)}
			>
				Stop tracking
			</Button>
		</SettingsRow>
	);
}

interface RepoGroupProps {
	repos: Repo[];
	/** Opens the repository browser. */
	onAdd: () => void;
}

/**
 * Settings → Connections → Repositories: the tracked repositories, each with
 * Stop tracking (Undo in its toast brings the row back), and Add repository
 * in the group's head.
 */
export function RepoGroup({ repos, onAdd }: RepoGroupProps) {
	const { add, leaving, settle } = useFocusHandoff(repos);

	function stop(repo: Repo, button: HTMLButtonElement): void {
		leaving(repo, button);
		stopTracking(repo);
	}

	return (
		<SettingsGroup
			title="Repositories"
			action={
				<Button ref={add} variant="ghost" onClick={onAdd}>
					<Plus aria-hidden />
					Add repository
				</Button>
			}
		>
			<AnimatePresence initial={false} onExitComplete={settle}>
				{repos.length === 0 ? (
					<Fold key="empty">
						<SettingsRow
							name="No repositories yet"
							detail="Add a repository to see its open pull requests in Pull requests."
						/>
					</Fold>
				) : (
					repos.map((repo) => (
						<Fold key={repo.id} repoId={repo.id}>
							<RepoRow repo={repo} onStop={stop} />
						</Fold>
					))
				)}
			</AnimatePresence>
		</SettingsGroup>
	);
}
