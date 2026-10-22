'use client';

import type { Repo } from '@recoder/shared';
import { Button, DURATION, EASE_OUT, ForgeMark, Tooltip } from '@recoder/ui';
import { Plus, X } from 'lucide-react';
import { AnimatePresence, motion, type Transition, type Variants } from 'motion/react';
import { useRef, type ReactNode } from 'react';

import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';

import { stopTracking } from '@/lib/connections/stop-tracking';

const FOLD: Transition = { duration: DURATION.disclose, ease: EASE_OUT };

/** A row unfolds to its height as it joins the list and folds away as it leaves; the rows under it follow. */
const ROW: Variants = {
	hidden: { height: 0, opacity: 0, transition: { height: FOLD, opacity: { duration: DURATION.swap } } },
	shown: { height: 'auto', opacity: 1, transition: { height: FOLD, opacity: { duration: DURATION.toggle } } }
};

/** One item of the list, folding in and out. */
function Fold({ children }: { children: ReactNode }) {
	return (
		<motion.div className="repo-item" variants={ROW} initial="hidden" animate="shown" exit="hidden">
			{children}
		</motion.div>
	);
}

interface RepoRowProps {
	repo: Repo;
	onRemove: (repo: Repo, button: HTMLButtonElement) => void;
}

function RepoRow({ repo, onRemove }: RepoRowProps) {
	return (
		<div className="repo-row" data-repo={repo.id}>
			<ForgeMark provider={repo.provider} className="text-fg-subtle" />
			<span className="repo-name" title={repo.url}>
				{repo.name}
			</span>
			<Tooltip content="Stop tracking">
				<Button
					variant="quiet"
					size="icon"
					aria-label={`Stop tracking ${repo.name}`}
					className="text-fg-subtle hover:text-fg"
					onClick={(event) => onRemove(repo, event.currentTarget)}
				>
					<X aria-hidden />
				</Button>
			</Tooltip>
		</div>
	);
}

/** The row that takes over a removed row's place in the tab order: the next one, else the one before. */
function neighborOf(repos: Repo[], repo: Repo): Repo | null {
	const index = repos.findIndex((item) => item.id === repo.id);

	return repos[index + 1] ?? repos[index - 1] ?? null;
}

/**
 * Hands keyboard focus on once a removed row has folded away: to the
 * neighbor's Stop tracking button, or to Add repository when the list is
 * empty. Only a removal made from the keyboard moves focus; a click leaves it.
 */
function useFocusHandoff(repos: Repo[]) {
	const add = useRef<HTMLButtonElement>(null);
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

/**
 * Settings → Connections → Repositories: the tracked repositories, each with
 * a way to stop tracking it (Undo in the toast brings it back), and Add
 * repository to open the repo browser. Rows fold in and out as the list
 * changes.
 */
export function RepoGroup({ repos, onAdd }: { repos: Repo[]; onAdd: () => void }) {
	const { add, leaving, settle } = useFocusHandoff(repos);

	function remove(repo: Repo, button: HTMLButtonElement): void {
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
							name="No repositories tracked yet"
							description="Add one and its open pull requests land in the queue"
						/>
					</Fold>
				) : (
					repos.map((repo) => (
						<Fold key={repo.id}>
							<RepoRow repo={repo} onRemove={remove} />
						</Fold>
					))
				)}
			</AnimatePresence>
		</SettingsGroup>
	);
}
