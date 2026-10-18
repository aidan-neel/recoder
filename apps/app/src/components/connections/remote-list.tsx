'use client';

import type { RemoteRepo } from '@recoder/shared';
import { Button, ForgeMark, HoverList, Pill, ScrollArea, Skeleton, swapMotion, useMotionVariants } from '@recoder/ui';
import { Check, Plus } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, type ReactNode } from 'react';

import type { Forge } from '@/lib/api/connections';
import { OFFLINE_TEXT } from '@/lib/api/http';
import { trackedKeys, useConnections, type RemoteList as Remote } from '@/lib/connections/connections-store';
import { FORGES, forgeLabel, signedInForges } from '@/lib/connections/forges';
import { repoKey } from '@/lib/connections/repo-input';
import { queryTerms } from '@/lib/settings/model-options';
import { errorToast } from '@/lib/shell/notify';
import { useAction } from '@/lib/shell/use-action';

import { useAddRepo } from './use-add-repo';

const SKELETON_WIDTHS = ['w-[44%]', 'w-[30%]', 'w-[52%]', 'w-[36%]', 'w-[40%]', 'w-[28%]', 'w-[48%]'];

/** A row's right end: Add, which turns into "Tracked" once the server has it. */
function RowAction({ repo, tracked }: { repo: RemoteRepo; tracked: boolean }) {
	const swap = useMotionVariants(swapMotion);
	const [status, add] = useAddRepo();

	async function track(): Promise<void> {
		const result = await add({ name: repo.name, url: repo.url, provider: repo.provider });

		if ('error' in result) errorToast(`Couldn’t add ${repo.name}`, result.error);
	}

	return (
		<AnimatePresence initial={false} mode="popLayout">
			{tracked ? (
				<motion.span
					key="tracked"
					className="remote-tracked"
					variants={swap}
					initial="initial"
					animate="animate"
					exit="exit"
				>
					<Check aria-hidden />
					Tracked
				</motion.span>
			) : (
				<motion.span key="add" variants={swap} initial="initial" animate="animate" exit="exit">
					<Button
						variant="ghost"
						status={status}
						errorLabel="Failed"
						aria-label={`Add ${repo.name}`}
						onClick={() => void track()}
					>
						<Plus aria-hidden />
						Add
					</Button>
				</motion.span>
			)}
		</AnimatePresence>
	);
}

function RemoteRow({ repo, tracked }: { repo: RemoteRepo; tracked: boolean }) {
	return (
		<li data-row className="remote-row">
			<ForgeMark provider={repo.provider} className="text-fg-subtle" />
			<span className="remote-name" title={repo.name}>
				{repo.name}
			</span>
			{repo.isPrivate ? <Pill className="shrink-0">private</Pill> : null}
			<span className="remote-action">
				<RowAction repo={repo} tracked={tracked} />
			</span>
		</li>
	);
}

/** Rows of shimmer where the list will land; invisible for the first 200ms. */
function RemoteSkeleton() {
	return (
		<ul className="remote-list" aria-label="Listing repositories" aria-busy>
			{SKELETON_WIDTHS.map((width) => (
				<li key={width} className="remote-row">
					<Skeleton className="size-3.5 shrink-0 rounded-full" />
					<span className="flex-1">
						<Skeleton className={`h-2.5 ${width}`} />
					</span>
					<Skeleton className="h-7 w-[83px] rounded-[8px]" />
				</li>
			))}
		</ul>
	);
}

interface ListMessageProps {
	children: ReactNode;
	/** The server's reason, on a quieter line under the sentence. */
	detail?: string | null;
	action?: ReactNode;
}

/** A sentence where the list would be, with an optional reason and way out under it. */
function ListMessage({ children, detail, action }: ListMessageProps) {
	return (
		<div className="remote-message" role="status">
			<div>
				<p className="text-fg-muted">{children}</p>
				{detail ? <p className="remote-detail">{detail}</p> : null}
			</div>
			{action}
		</div>
	);
}

/** Keeps the rows whose name holds every word of the query. */
function matching(repos: RemoteRepo[], query: string): RemoteRepo[] {
	const terms = queryTerms(query);

	return repos.filter((repo) => terms.every((term) => repo.name.toLowerCase().includes(term)));
}

/** True when a forge's list failed, including while a retry of it runs. */
function failedList(list: Remote | undefined): boolean {
	return list?.status === 'error' || list?.status === 'retrying';
}

/** Try again for failed lists: pending while any of them lists again, then gone or back to idle with the new reason. */
function RetryButton({ forges, lists }: { forges: Forge[]; lists: Partial<Record<Forge, Remote>> }) {
	const retrying = forges.some((forge) => lists[forge]?.status === 'retrying');

	return (
		<Button
			variant="outline"
			status={retrying ? 'pending' : 'idle'}
			onClick={() => forges.forEach((forge) => void useConnections.getState().loadRemote(forge))}
		>
			Try again
		</Button>
	);
}

/** Above the rows that did load: which forge's list failed, why, and a way to list it again. */
function FailedNote({ forge, lists }: { forge: Forge; lists: Partial<Record<Forge, Remote>> }) {
	return (
		<div className="remote-note" role="status">
			<div className="min-w-0 flex-1">
				<p className="text-fg-muted">Couldn’t list {forgeLabel(forge)} repositories.</p>
				{lists[forge]?.error ? <p className="remote-detail">{lists[forge].error}</p> : null}
			</div>
			<RetryButton forges={[forge]} lists={lists} />
		</div>
	);
}

/** The signed-in forges' repositories, once each list has loaded. */
function ForgeRepos({ forges, query }: { forges: Forge[]; query: string }) {
	const lists = useConnections((state) => state.remote);
	const repos = useConnections((state) => state.repos);
	const tracked = trackedKeys(repos);
	const loaded = forges.map((forge) => lists[forge]);
	const failed = forges.filter((forge) => failedList(lists[forge]));

	const rows = matching(
		loaded.flatMap((list) => (list?.status === 'ready' ? list.repos : [])),
		query
	);

	const key = forges.join(' ');

	useEffect(() => {
		for (const forge of key.split(' ')) void useConnections.getState().loadRemote(forge as Forge);
	}, [key]);

	if (loaded.some((list) => !list || list.status === 'loading')) return <RemoteSkeleton />;

	if (failed.length === forges.length) {
		return (
			<ListMessage detail={lists[failed[0]]?.error} action={<RetryButton forges={failed} lists={lists} />}>
				Couldn’t list repositories.
			</ListMessage>
		);
	}

	if (rows.length === 0) {
		return (
			<ListMessage>
				{query.trim() ? `No repositories match “${query.trim()}”.` : 'No repositories on this account.'}
			</ListMessage>
		);
	}

	return (
		<ScrollArea className="remote-scroll">
			{failed.map((forge) => (
				<FailedNote key={forge} forge={forge} lists={lists} />
			))}
			<HoverList as="ul" itemSelector="[data-row]" className="remote-list" highlightClassName="remote-hover">
				{rows.map((repo) => (
					<RemoteRow key={repo.url} repo={repo} tracked={tracked.has(repoKey(repo.url))} />
				))}
			</HoverList>
		</ScrollArea>
	);
}

interface RemoteListProps {
	query: string;
	/** Opens the token dialog, for the message shown while no forge is signed in. */
	onConnect: (forge: Forge) => void;
}

/**
 * What the repo browser lists: the repositories the signed-in forges can
 * see, filtered by the search, tracked ones marked. It holds a fixed height,
 * so loading and searching never resize the dialog.
 */
export function RemoteList({ query, onConnect }: RemoteListProps) {
	const auth = useConnections((state) => state.auth);
	const authStatus = useConnections((state) => state.authStatus);
	const authError = useConnections((state) => state.authError);
	const forges = signedInForges(auth);
	const recheck = useAction();

	if (!auth && (authStatus === 'error' || authStatus === 'offline')) {
		return (
			<ListMessage
				detail={authError}
				action={
					<Button
						variant="outline"
						status={recheck.status}
						onClick={() => recheck.run(() => useConnections.getState().loadAuth())}
					>
						Try again
					</Button>
				}
			>
				{authError ? 'Couldn’t check the forges.' : OFFLINE_TEXT}
			</ListMessage>
		);
	}

	if (!auth) return <RemoteSkeleton />;

	if (forges.length === 0) {
		return (
			<ListMessage
				action={
					<div className="flex gap-2">
						{FORGES.map((forge) => (
							<Button key={forge.id} variant="outline" onClick={() => onConnect(forge.id)}>
								<ForgeMark provider={forge.id} />
								Connect {forge.label}
							</Button>
						))}
					</div>
				}
			>
				Connect GitHub or GitLab to browse your repositories.
			</ListMessage>
		);
	}

	return <ForgeRepos forges={forges} query={query} />;
}
