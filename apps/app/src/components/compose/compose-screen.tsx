'use client';

import { Button, HoverList, RowButton, Select, SkeletonRows, Textarea } from '@recoder/ui';
import { ArrowUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type KeyboardEvent } from 'react';

import type { ComposeView } from '@/lib/compose/types';
import { useCompose } from '@/lib/compose/use-compose';
import type { PullRow } from '@/lib/pulls/types';

import { Crumbs } from '@/components/common/crumbs';
import { Page } from '@/components/common/page';
import { PullMark } from '@/components/common/pull-mark';

interface Hint {
	tone: 'ready' | 'danger' | 'quiet';
	text: string;
}

/** What the line under the field says about the text: what it will review, or why it cannot. */
function hintFor({ target, brief }: Pick<ComposeView, 'target' | 'brief'>): Hint {
	const focus = brief ? ` It will look at: ${brief}` : '';

	if (target.kind === 'pull') {
		return { tone: 'ready', text: `Enter reviews ${target.repoName} #${target.number}.${focus}` };
	}

	if (target.kind === 'untracked') {
		return {
			tone: 'ready',
			text: `${target.repoName} is not connected yet. Enter connects it and reviews #${target.number}.${focus}`
		};
	}

	if (target.kind === 'invalid') return { tone: 'danger', text: target.reason };

	return { tone: 'quiet', text: 'After the link, you can say what the review should look at.' };
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
	const hint: Hint = error ? { tone: 'danger', text: error } : hintFor(compose);
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
	function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
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
						<Textarea
							autosize
							autoFocus
							minRows={2}
							maxRows={8}
							aria-label="A pull request link, a number or a branch"
							placeholder="Paste a pull request link, or name a branch"
							spellCheck={false}
							value={compose.text}
							invalid={compose.target.kind === 'invalid'}
							onChange={(event) => {
								setError(null);
								compose.setText(event.target.value);
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
					<p className="compose-hint" data-tone={hint.tone} role={hint.tone === 'danger' ? 'alert' : 'status'}>
						{hint.text}
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
