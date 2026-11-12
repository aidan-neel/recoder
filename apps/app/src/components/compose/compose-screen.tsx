'use client';

import { Button, HoverList, LinkField, RowButton, Select, SkeletonRows } from '@recoder/ui';
import { ArrowUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type KeyboardEvent } from 'react';

import type { ComposeView } from '@/lib/compose/types';
import { useCompose } from '@/lib/compose/use-compose';
import type { PullRow } from '@/lib/pulls/types';

import { Crumbs } from '@/components/common/crumbs';
import { Page } from '@/components/common/page';
import { PullMark } from '@/components/common/pull-mark';

interface Note {
	tone: 'ready' | 'danger';
	text: string;
}

/**
 * The line under the field, only when the field does not say it already: why
 * the review cannot start, or that starting it first connects the
 * repository. The embed names the target, so a ready target needs no line.
 */
function noteFor(target: ComposeView['target'], error: string | null): Note | null {
	if (error) return { tone: 'danger', text: error };
	if (target.kind === 'invalid') return { tone: 'danger', text: target.reason };
	if (target.kind === 'untracked') return { tone: 'ready', text: `Enter connects ${target.repoName} first.` };

	return null;
}

interface SuggestionsProps {
	rows: PullRow[];
	loading: boolean;
	onPick: (row: PullRow) => void;
}

/** Open pull requests with no review yet, so the usual next review is one click away. */
function Suggestions({ rows, loading, onPick }: SuggestionsProps) {
	if (!loading && rows.length === 0) return null;

	return (
		<section className="compose-suggestions" aria-label="Not reviewed yet">
			<h2 className="section-label">Not reviewed yet</h2>
			{loading ? (
				<SkeletonRows count={3} height={38} glyph lines={1} />
			) : (
				<HoverList itemSelector="[data-suggestion]">
					{rows.map((row) => (
						<RowButton key={row.key} data-suggestion className="suggestion-row" onClick={() => onPick(row)}>
							<PullMark />
							<span className="suggestion-title">{row.title}</span>
							<span className="meta">
								{row.repoName} #{row.number}
							</span>
						</RowButton>
					))}
				</HoverList>
			)}
		</section>
	);
}

/**
 * New review: one field that takes a pull request link, a number or a
 * branch, then optionally what to look at. Enter starts the review and opens
 * the pull request; the pull requests with no review yet sit below, one
 * click each.
 */
export function ComposeScreen() {
	const router = useRouter();
	const compose = useCompose();
	const [error, setError] = useState<string | null>(null);
	const note = noteFor(compose.target, error);
	const ready = compose.target.kind === 'pull' || compose.target.kind === 'untracked';

	/** Starts a review and opens its pull request; a refusal stays under the field. */
	function start(begin: () => Promise<string>): void {
		setError(null);

		begin().then(
			(href) => router.push(href),
			(failure: unknown) => setError(failure instanceof Error ? failure.message : 'The review did not start.')
		);
	}

	/** Enter starts the review, unless Shift is held or the text is still being composed. */
	function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
		if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;

		event.preventDefault();
		if (ready && !compose.submitting) start(compose.submit);
	}

	return (
		<Page start={<Crumbs parts={[{ label: 'New review' }]} />}>
			<div className="compose">
				<div className="compose-column">
					<h1 className="compose-title">What should Recoder review?</h1>
					<div className="composer">
						<LinkField
							autosize
							autoFocus
							minRows={2}
							maxRows={8}
							aria-label="A pull request link, a number or a branch"
							placeholder="Paste a pull request link, or name a branch"
							spellCheck={false}
							value={compose.text}
							invalid={compose.target.kind === 'invalid'}
							linkFacts={compose.linkFacts}
							onValueChange={(text) => {
								setError(null);
								compose.setText(text);
							}}
							onKeyDown={onKeyDown}
						/>
						<div className="composer-foot">
							{compose.repos.length > 0 ? (
								<Select
									variant="quiet"
									size="sm"
									aria-label="Repository a number or a branch is looked up in"
									value={compose.repoId ?? ''}
									onValueChange={compose.setRepoId}
									options={compose.repos.map((repo) => ({ value: repo.id, label: repo.name }))}
									placeholder="Repository"
								/>
							) : null}
							<div className="composer-end">
								<Button
									variant="primary"
									size="icon"
									className="composer-send"
									aria-label="Start the review"
									disabled={!ready}
									status={compose.submitting ? 'pending' : 'idle'}
									onClick={() => start(compose.submit)}
								>
									<ArrowUp />
								</Button>
							</div>
						</div>
					</div>
					<p className="compose-hint" data-tone={note?.tone} role={note?.tone === 'danger' ? 'alert' : 'status'}>
						{note?.text}
					</p>
					<Suggestions
						rows={compose.suggestions}
						loading={compose.loading}
						onPick={(row) => start(() => compose.submitRow(row))}
					/>
				</div>
			</div>
		</Page>
	);
}
