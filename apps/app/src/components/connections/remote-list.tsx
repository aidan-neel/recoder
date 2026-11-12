'use client';

import type { ProviderAuth, RemoteRepo } from '@recoder/shared';
import {
	Button,
	ForgeMark,
	HoverList,
	Pill,
	ScrollArea,
	SkeletonRows,
	StatusNotice,
	swapMotion,
	useMotionVariants
} from '@recoder/ui';
import { Check, Plus } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect } from 'react';

import type { Forge } from '@/lib/api/connections';
import { OFFLINE_TEXT } from '@/lib/api/http';
import { retryAuth, trackedKeys, useConnections, type RemoteList as Remote } from '@/lib/connections/connections-store';
import { FORGES, forgeLabel, rejectedForges, signedInForges } from '@/lib/connections/forges';
import { repoKey } from '@/lib/connections/repo-input';
import { queryTerms } from '@/lib/settings/model-options';
import { retryToast } from '@/lib/shell/notify';
import { useAction } from '@/lib/shell/use-action';

import { useAddRepo } from './use-add-repo';
import type { Connect } from './use-token-dialog';

/** Name widths for the placeholder rows, so they don't read as copies; the second width goes unused on one-line rows. */
const SKELETON_WIDTHS = [
	['44%', ''],
	['30%', ''],
	['52%', ''],
	['36%', ''],
	['40%', ''],
	['28%', ''],
	['48%', ''],
	['34%', '']
] as const;

/** A row of the list (`.remote-row`), for its placeholder rows. */
const ROW_HEIGHT = 38;

/** A row's right end: Add, which turns into "Tracked" once the server has it. */
function RowAction({ repo, tracked }: { repo: RemoteRepo; tracked: boolean }) {
	const swap = useMotionVariants(swapMotion);
	const [status, add] = useAddRepo();

	async function track(): Promise<void> {
		const result = await add({ name: repo.name, url: repo.url, provider: repo.provider });

		if ('error' in result) retryToast(`Couldn’t add ${repo.name}`, result.error, () => void track());
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

/** Rows of shimmer where the list will land, invisible for the kit's skeleton delay. */
function RemoteSkeleton() {
	return (
		<div role="status" aria-label="Listing repositories" aria-busy>
			<SkeletonRows
				count={SKELETON_WIDTHS.length}
				height={ROW_HEIGHT}
				glyph
				lines={1}
				widths={SKELETON_WIDTHS}
				rowClassName="remote-row"
				className="remote-list"
			/>
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

type Lists = Partial<Record<Forge, Remote>>;

/** Try again for failed lists: pending while any of them lists again, then gone or back to idle with the new reason. */
function RetryButton({ forges, lists }: { forges: Forge[]; lists: Lists }) {
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

/** The forges in `failed` that refused their token: a new token fixes those, where a retry would not. */
function refused(failed: Forge[], lists: Lists): Forge[] {
	return failed.filter((forge) => lists[forge]?.kind === 'auth');
}

/** "GitHub rejected the token.", or every forge named when each rejected its own. */
function rejectedTitle(forges: Forge[]): string {
	if (forges.length === 1) return `${forgeLabel(forges[0])} rejected the token.`;

	return `${forges.map(forgeLabel).join(' and ')} rejected their tokens.`;
}

/** Opens the token dialog to replace the token a forge refused. */
function UpdateToken({ forge, onConnect }: { forge: Forge; onConnect: Connect }) {
	return (
		<Button variant="outline" onClick={() => onConnect(forge, true)}>
			<ForgeMark provider={forge} />
			Update {forgeLabel(forge)} token
		</Button>
	);
}

/** The ways out of failed lists: a new token for each forge that refused its token, and Try again for the rest. */
function FailedActions({ failed, lists, onConnect }: { failed: Forge[]; lists: Lists; onConnect: Connect }) {
	const rejected = refused(failed, lists);
	const others = failed.filter((forge) => !rejected.includes(forge));

	return (
		<>
			{rejected.map((forge) => (
				<UpdateToken key={forge} forge={forge} onConnect={onConnect} />
			))}
			{others.length ? <RetryButton forges={others} lists={lists} /> : null}
		</>
	);
}

/**
 * What failed lists say. A forge that refused its token says only that,
 * since its button gets the new token; lists that failed otherwise say which
 * over the reason, beside Try again. When both happen the refusal leads, and
 * the other forge is named under it, beside its Try again.
 */
function failedCopy(failed: Forge[], lists: Lists): { title: string; detail?: string | null } {
	const rejected = refused(failed, lists);
	const others = failed.filter((forge) => !rejected.includes(forge));

	const othersTitle =
		others.length === 1 ? `Couldn’t list ${forgeLabel(others[0])} repositories.` : 'Couldn’t list repositories.';

	if (rejected.length === 0) return { title: othersTitle, detail: lists[others[0]]?.error };
	if (others.length === 0) return { title: rejectedTitle(rejected) };

	return { title: rejectedTitle(rejected), detail: othersTitle };
}

interface ForgeReposProps {
	forges: Forge[];
	query: string;
	onConnect: Connect;
}

/** The signed-in forges' repositories, once each list has loaded. */
function ForgeRepos({ forges, query, onConnect }: ForgeReposProps) {
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
			<StatusNotice
				tone="danger"
				{...failedCopy(failed, lists)}
				actions={<FailedActions failed={failed} lists={lists} onConnect={onConnect} />}
			/>
		);
	}

	if (rows.length === 0) {
		return (
			<StatusNotice
				title={query.trim() ? `No repositories match “${query.trim()}”.` : 'No repositories on this account.'}
			/>
		);
	}

	return (
		<ScrollArea className="remote-scroll">
			{failed.map((forge) => (
				<StatusNotice
					key={forge}
					variant="inline"
					tone="danger"
					{...failedCopy([forge], lists)}
					actions={<FailedActions failed={[forge]} lists={lists} onConnect={onConnect} />}
					className="remote-note"
				/>
			))}
			<HoverList as="ul" itemSelector="[data-row]" className="remote-list" highlightClassName="remote-hover">
				{rows.map((repo) => (
					<RemoteRow key={repo.url} repo={repo} tracked={tracked.has(repoKey(repo.url))} />
				))}
			</HoverList>
		</ScrollArea>
	);
}

/** No forge signed in: connect one, or update the token a forge rejected, each from its own button. */
function SignedOut({ auth, onConnect }: { auth: Record<Forge, ProviderAuth>; onConnect: Connect }) {
	const repos = useConnections((state) => state.repos);
	const rejected = rejectedForges(auth, repos);

	return (
		<StatusNotice
			tone={rejected.length ? 'danger' : 'neutral'}
			title={rejected.length ? rejectedTitle(rejected) : 'Connect GitHub or GitLab to browse your repositories.'}
			actions={FORGES.map((forge) =>
				rejected.includes(forge.id) ? (
					<UpdateToken key={forge.id} forge={forge.id} onConnect={onConnect} />
				) : (
					<Button key={forge.id} variant="outline" onClick={() => onConnect(forge.id)}>
						<ForgeMark provider={forge.id} />
						Connect {forge.label}
					</Button>
				)
			)}
		/>
	);
}

interface RemoteListProps {
	query: string;
	/** Opens the token dialog: to connect a forge, or to replace the token it refused. */
	onConnect: Connect;
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
			<StatusNotice
				tone="danger"
				title={authError ? 'Couldn’t check the forges.' : OFFLINE_TEXT}
				detail={authError}
				actions={
					<Button variant="outline" status={recheck.status} onClick={() => recheck.run(retryAuth)}>
						Try again
					</Button>
				}
			/>
		);
	}

	if (!auth) return <RemoteSkeleton />;

	if (forges.length === 0) return <SignedOut auth={auth} onConnect={onConnect} />;

	return <ForgeRepos forges={forges} query={query} onConnect={onConnect} />;
}
