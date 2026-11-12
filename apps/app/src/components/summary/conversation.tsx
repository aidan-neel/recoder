'use client';

import type { PullComment } from '@recoder/shared';
import { Markdown, Pill, SkeletonRows, type PillTone } from '@recoder/ui';

import type { PullConversationView } from '@/lib/pull/types';
import { author } from '@/lib/shell/format';

import { Age } from '@/components/common/age';
import { Avatar } from '@/components/common/avatar';

const VERDICTS: Record<NonNullable<PullComment['verdict']>, { label: string; tone: PillTone }> = {
	approved: { label: 'Approved', tone: 'ok' },
	'changes-requested': { label: 'Requested changes', tone: 'danger' },
	commented: { label: 'Reviewed', tone: 'neutral' }
};

/** Where an inline comment sits: `lease.ts:20`. */
function place(entry: PullComment): string | null {
	if (!entry.path) return null;

	const file = entry.path.split('/').pop() ?? entry.path;

	return entry.line ? `${file}:${entry.line}` : file;
}

/** One entry of the forge conversation: who, what kind, when, then what they wrote. */
function Entry({ entry }: { entry: PullComment }) {
	const by = author(entry.author.login);
	const verdict = entry.verdict ? VERDICTS[entry.verdict] : null;
	const where = place(entry);

	return (
		<article className="entry" aria-label={`${by.name} wrote`}>
			<Avatar name={by.name} src={entry.author.avatarUrl} tone={entry.byRecoder ? 'recoder' : 'person'} />
			<div className="entry-head">
				<span className="entry-author">{entry.byRecoder ? 'Recoder' : by.name}</span>
				{verdict ? <Pill tone={verdict.tone}>{verdict.label}</Pill> : null}
				{where ? (
					<span className="meta mono" title={entry.path}>
						{where}
					</span>
				) : null}
				<Age at={entry.createdAt} className="meta" />
			</div>
			{entry.body ? (
				<div className="entry-body">
					<Markdown>{entry.body}</Markdown>
				</div>
			) : null}
		</article>
	);
}

/**
 * The pull request's conversation on its forge, oldest first. Its text is
 * other people's: it renders as markdown with no raw HTML. A forge with no
 * conversation shows nothing.
 */
export function Conversation({ view }: { view: PullConversationView }) {
	if (view.phase === 'off') return null;
	if (view.phase === 'loading') return <SkeletonRows count={2} height={56} glyph />;

	if (view.phase === 'failed') {
		return (
			<p className="meta text-danger" role="alert">
				The conversation did not load. {view.error}
			</p>
		);
	}

	if (view.entries.length === 0) return <p className="meta">Nobody has commented yet.</p>;

	return (
		<div className="thread">
			{view.entries.map((entry) => (
				<Entry key={entry.id} entry={entry} />
			))}
		</div>
	);
}
