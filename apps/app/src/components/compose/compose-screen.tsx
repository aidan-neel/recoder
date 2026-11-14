'use client';

import { Composer, ComposerSend, SegmentedControl, focusComposerField, type ComposerNote } from '@recoder/ui';
import { useRef, useState } from 'react';

import type { ComposeMode } from '@/lib/compose/compose-mode';
import { REVIEW_NEEDS_PULL } from '@/lib/compose/compose-target';
import type { ComposeView } from '@/lib/compose/types';
import { useCompose } from '@/lib/compose/use-compose';
import { useImageDraft } from '@/lib/compose/use-image-draft';
import { useOpenStarted } from '@/lib/compose/use-open-started';
import type { PullRow } from '@/lib/pulls/types';

import { ComposerModels } from '@/components/ask/model-menu';
import { Crumbs } from '@/components/common/crumbs';
import { Page } from '@/components/common/page';
import { RepoBrowser } from '@/components/connections/repo-browser';

import { AttachImages } from './attach-images';
import { PickerSkeleton } from './picker-skeleton';
import { PullPicker } from './pull-picker';
import { RepoPicker } from './repo-picker';
import { Suggestions } from './suggestions';

const MODES: { value: ComposeMode; label: string }[] = [
	{ value: 'review', label: 'Review' },
	{ value: 'chat', label: 'Chat' }
];

/**
 * New: one field, a little above the middle of the page. In Review mode the
 * pull request is a choice, made in the composer's bar or from the list
 * below, and the field is the brief: what the review should look at. A
 * `#214` or a link typed or pasted into it moves into the choice. Enter
 * starts the review of the choice with the brief, which may be empty, and
 * opens the pull request. In Chat mode the field takes anything about the
 * repository; Enter opens the chat. The title and the mode sit over the
 * field; the repository, the pull request, images and models sit in its bar.
 * Images go with the brief or the chat's first message. The pull requests
 * with no review yet sit below; a click chooses one and puts the caret in
 * the field.
 */
export function ComposeScreen() {
	const compose = useCompose();
	const images = useImageDraft();
	const started = useOpenStarted(compose.clear);
	const [error, setError] = useState<string | null>(null);
	const [browsing, setBrowsing] = useState(false);
	const column = useRef<HTMLDivElement>(null);
	const chat = compose.mode === 'chat';

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

	/** A suggestion chooses its pull request, in Review mode, and puts the caret in the field for the brief. */
	function pickRow(row: PullRow): void {
		setError(null);
		compose.setMode('review');
		compose.choose(row);
		focusComposerField(column.current?.querySelector('[data-ui="composer"]') ?? null);
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
		<Page start={<Crumbs parts={[{ label: chat ? 'New chat' : 'New review' }]} />}>
			<div className="compose">
				<div ref={column} className="compose-column">
					<div className="compose-head">
						<h1 className="compose-title">Recoder</h1>
						<SegmentedControl
							aria-label="What to start"
							className="compose-mode"
							value={compose.mode}
							options={MODES}
							onValueChange={chooseMode}
						/>
					</div>
					<Composer
						size="lg"
						minRows={3}
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
						tools={
							<>
								<AttachImages onAttach={images.add} />
								{compose.loading ? (
									<>
										<PickerSkeleton width={140} />
										{chat ? null : <PickerSkeleton width={180} />}
									</>
								) : (
									<>
										<RepoPicker
											repos={compose.repos}
											repoId={compose.repoId}
											onPick={compose.setRepoId}
											onAdd={() => setBrowsing(true)}
										/>
										{chat || !compose.repoId ? null : (
											<PullPicker rows={compose.pulls} pick={compose.pick} onPick={compose.choose} />
										)}
									</>
								)}
							</>
						}
						trailing={<ComposerModels />}
						action={
							<ComposerSend
								label={chat ? 'Start the chat' : 'Start the review'}
								disabled={!compose.ready}
								pending={started.opening}
								onClick={submit}
							/>
						}
					/>
					<Suggestions
						rows={compose.suggestions}
						loading={compose.loading}
						picked={chat ? null : (compose.pick?.target ?? null)}
						onPick={pickRow}
					/>
				</div>
			</div>
			<RepoBrowser open={browsing} onOpenChange={browse} />
		</Page>
	);
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
	if (compose.overBy > 0) return { tone: 'danger', text: `${compose.overBy.toLocaleString('en-US')} over the limit` };

	return null;
}
