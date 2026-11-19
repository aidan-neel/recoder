'use client';

import { Composer, ComposerSend, SegmentedControl, focusComposerField, type ComposerNote } from '@recoder/ui';
import { useEffect, useRef, useState } from 'react';

import type { ComposeMode } from '@/lib/compose/compose-mode';
import { REVIEW_NEEDS_PULL } from '@/lib/compose/compose-target';
import type { ComposeList, ComposeRepo, ComposeView } from '@/lib/compose/types';
import { useCompose } from '@/lib/compose/use-compose';
import { useImageDraft } from '@/lib/compose/use-image-draft';
import { useOpenStarted } from '@/lib/compose/use-open-started';
import type { PullRow } from '@/lib/pulls/types';
import { formatCount } from '@/lib/shell/format';
import { useRepoSkills } from '@/lib/skills/use-repo-skills';

import { ComposerModels } from '@/components/ask/model-menu';
import { Crumbs } from '@/components/common/crumbs';
import { FindField } from '@/components/common/find-field';
import { Page } from '@/components/common/page';
import { RepoBrowser } from '@/components/connections/repo-browser';
import { RepoSelect } from '@/components/pulls/pulls-bar';

import { AttachImages } from './attach-images';
import { ChatList } from './chat-list';
import { PickerSkeleton } from './picker-skeleton';
import { PullChoices } from './pull-choices';
import { PullPicker } from './pull-picker';
import { RepoPicker } from './repo-picker';

const MODES: { value: ComposeMode; label: string }[] = [
	{ value: 'review', label: 'Review' },
	{ value: 'chat', label: 'Chat' }
];

/** The most rows the docked field grows to before it scrolls, so the list over it keeps its room. */
const MAX_ROWS = 8;

/**
 * New: the choices fill the page and the composer is docked at its foot. In
 * Review mode the page lists the open pull requests, those with no review
 * yet first; a click chooses one and puts the caret in the composer, whose
 * field is the brief: what the review should look at. A `#214` or a link
 * typed or pasted into the brief, or pasted into the find field, moves into
 * the choice. Enter starts the review of the choice with the brief, which
 * may be empty, and opens the pull request. In Chat mode the page lists the
 * newest chats, the field takes anything about the repository, and Enter
 * opens the chat. The mode sits in the page's bar; the repository, the pull
 * request, images and models sit in the composer's bar, and in Review mode
 * the model menu also holds the review's speed. Images go with the brief or
 * the chat's first message, and "/" offers the repository's skills, a chosen
 * pull request's head included.
 */
export function ComposeScreen() {
	const compose = useCompose();
	const images = useImageDraft();
	const started = useOpenStarted(compose.clear);
	const [error, setError] = useState<string | null>(null);
	const [browsing, setBrowsing] = useState(false);
	const dock = useRef<HTMLDivElement>(null);
	const chat = compose.mode === 'chat';
	const skills = useRepoSkills(skillSource(compose));

	/** Starts a review or a chat and opens its page; a refusal stays in the composer's bar. */
	function start(begin: () => Promise<string>): void {
		setError(null);
		started.open(begin, (failure) => setError(failure instanceof Error ? failure.message : 'That did not start.'));
	}

	/**
	 * Starts the review of the chosen pull request or the chat, with the images attached; both stay in the field
	 * until the page opens. With no pull request chosen, a `#214` still being typed is chosen first, and otherwise
	 * the bar says one is needed.
	 */
	function submit(): void {
		if (started.opening) return;

		if (!chat && !compose.pick) {
			if (compose.hasTypedPull) compose.settle();
			else setError(REVIEW_NEEDS_PULL);

			return;
		}

		if (!compose.ready) return;

		start(() => compose.submit(images.uploads()));
	}

	/** A pull request chosen from the page, from a row or a link in the find field, puts the caret in the field for the brief. */
	useEffect(() => {
		if (compose.pick) focusComposerField(dock.current?.querySelector('[data-ui="composer"]') ?? null);
	}, [compose.pick]);

	/** A row chooses its pull request. */
	function pickRow(row: PullRow): void {
		setError(null);
		compose.choose(row);
	}

	/** Closing the repository dialog reads the list again, so a repository just added is there to pick. */
	function browse(open: boolean): void {
		setBrowsing(open);

		if (!open) compose.reload();
	}

	function edit(text: string): void {
		setError(null);
		compose.setText(text);
	}

	/** The switch hands back a string; only a known mode is taken. */
	function chooseMode(value: string): void {
		const mode = MODES.find((option) => option.value === value)?.value;

		if (!mode) return;

		setError(null);
		compose.setMode(mode);
	}

	return (
		<Page
			start={<Crumbs parts={[{ label: chat ? 'New chat' : 'New review' }]} />}
			end={
				<SegmentedControl aria-label="What to start" value={compose.mode} options={MODES} onValueChange={chooseMode} />
			}
		>
			<div className="compose">
				<div className="page-column compose-scroll">
					<div className="compose-column">
						<Finder list={compose.list} repos={compose.repos} chat={chat} />
						{chat ? (
							<ChatList list={compose.list} />
						) : (
							<PullChoices
								list={compose.list}
								loading={compose.pullsLoading}
								picked={compose.pick?.target ?? null}
								onPick={pickRow}
							/>
						)}
					</div>
				</div>
				<div ref={dock} className="page-column compose-dock">
					<div className="compose-column">
						<Composer
							size="lg"
							maxRows={MAX_ROWS}
							autoFocus
							spellCheck={chat}
							label={chat ? 'A question about the repository' : 'The brief: what the review should look at'}
							placeholder={placeholderFor(compose)}
							value={compose.text}
							onValueChange={edit}
							onSubmit={submit}
							invalid={chat && compose.overBy > 0}
							linkFacts={compose.linkFacts}
							note={noteFor(compose, error ?? images.refusal)}
							onFiles={images.add}
							images={images.images}
							onRemoveImage={images.remove}
							skills={skills}
							tools={<AttachImages onAttach={images.add} />}
							targets={
								<>
									{compose.reposLoading ? (
										<PickerSkeleton width={140} />
									) : (
										<RepoPicker
											repos={compose.repos}
											repoId={compose.repoId}
											onPick={compose.setRepoId}
											onAdd={() => setBrowsing(true)}
										/>
									)}
									{chat ? null : <PullChoice compose={compose} />}
								</>
							}
							trailing={
								<ComposerModels speed={chat ? undefined : { speed: compose.speed, onSpeedChange: compose.setSpeed }} />
							}
							action={
								<ComposerSend
									label={chat ? 'Start the chat' : 'Start the review'}
									disabled={!compose.ready}
									pending={started.opening}
									onClick={submit}
								/>
							}
						/>
					</div>
				</div>
			</div>
			<RepoBrowser open={browsing} onOpenChange={browse} />
		</Page>
	);
}

interface FinderProps {
	list: ComposeList;
	repos: ComposeRepo[];
	/** True in Chat mode, where the lists hold chats. */
	chat: boolean;
}

/** The find field over the lists, and the repository filter once there are two repositories to choose between. */
function Finder({ list, repos, chat }: FinderProps) {
	return (
		<div className="compose-find">
			<FindField
				className="compose-find-field"
				label={chat ? 'Find a chat' : 'Find a pull request, or paste a link'}
				placeholder={chat ? 'Find a chat' : 'Find a pull request, or paste a link'}
				query={list.query}
				onQueryChange={list.setQuery}
				onSubmit={list.settleQuery}
			/>
			{repos.length > 1 ? (
				<RepoSelect className="compose-find-scope" repos={repos} repoId={list.repoId} onChange={list.setRepoId} />
			) : null}
		</div>
	);
}

/** The pull request picker in Review mode, held as a skeleton until the pull requests answer. */
function PullChoice({ compose }: { compose: ComposeView }) {
	if (compose.reposLoading || compose.pullsLoading) return <PickerSkeleton width={180} />;
	if (!compose.repoId) return null;

	return <PullPicker rows={compose.pulls} pick={compose.pick} onPick={compose.choose} />;
}

/** Where "/" reads skills: the chosen pull request in Review mode, else the chosen repository. */
function skillSource(compose: ComposeView): { repoId: string | null; pull?: number } {
	const target = compose.mode === 'review' ? compose.pick?.target : undefined;

	if (target?.kind === 'pull') return { repoId: target.repoId, pull: target.number };

	return { repoId: compose.repoId };
}

/** What to write, by mode; a chat names its repository. */
function placeholderFor(compose: ComposeView): string {
	if (compose.mode === 'review') return 'What should the review look at?';

	const repo = compose.repos.find((candidate) => candidate.id === compose.repoId);

	return repo ? `Ask anything about ${repo.name}` : 'Ask anything about the repository';
}

/**
 * The line in the composer's bar, only when the field does not say it
 * already: a refusal (of the start, of an image, or of a pull request typed
 * into the field), or how far a chat runs over the limit. Never a hint.
 */
function noteFor(compose: ComposeView, error: string | null): ComposerNote | null {
	const refusal = error ?? compose.refusal;

	if (refusal) return { tone: 'danger', text: refusal };
	if (compose.mode === 'chat') return chatNote(compose);

	return null;
}

/** A chat's line: how far it runs over the limit. With no repository the bar offers to add one instead. */
function chatNote(compose: ComposeView): ComposerNote | null {
	if (compose.overBy > 0) return { tone: 'danger', text: `${formatCount(compose.overBy)} over the limit` };

	return null;
}
