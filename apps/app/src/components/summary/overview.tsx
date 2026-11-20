'use client';

import { ClampedText, Pill, Skeleton } from '@recoder/ui';

import type { BugsView, SummaryView } from '@/lib/bugs/types';
import { shortSha } from '@/lib/files/ref-label';
import type { RunView } from '@/lib/run/types';
import { author } from '@/lib/shell/format';
import { severityCounts } from '@/lib/summary/bug-tones';
import { LOADING_SUMMARY } from '@/lib/summary/loading-summary';

import { Age } from '@/components/common/age';

import { SummaryProse } from './prose';

interface OverviewProps {
	summary: SummaryView;
	run: RunView;
	bugs: BugsView;
	/** The pull request author's login; null before the page loads. */
	by: string | null;
	/** True until the review's record arrives: the overview stands as a skeleton measured from a stand-in account. */
	loading: boolean;
}

/**
 * What the change does at a glance: the review's account of it as the lede,
 * shut to its first lines; its open findings as badges with the commit it
 * read; then the author's own description, quieter and shorter. Model and
 * author text show as written, never cut but behind Show more.
 */
export function Overview({ summary, run, bugs, by, loading }: OverviewProps) {
	if (!loading && !summary.analysis && !summary.description) return null;

	const shown = loading ? LOADING_SUMMARY : summary;

	return (
		<Skeleton id="summary-overview" loading={loading}>
			<section className="summary-overview" aria-label="Overview">
				{shown.analysis ? (
					<>
						<ClampedText lines={4} className="summary-lede">
							<SummaryProse>{shown.analysis}</SummaryProse>
						</ClampedText>
						{loading ? <LoadingFacts /> : <OverviewFacts run={run} bugs={bugs} />}
					</>
				) : null}
				{shown.description ? <AuthorDescription text={shown.description} by={by} /> : null}
			</section>
		</Skeleton>
	);
}

/** The facts' line while the review's record loads: a badge and the commit, for the skeleton to measure. */
function LoadingFacts() {
	return (
		<div className="summary-facts">
			<Pill>2 high</Pill>
			<span className="summary-reviewed">Reviewed 0000000 an hour ago</span>
		</div>
	);
}

/** The open findings by severity as badges, then the commit the review read and when. */
function OverviewFacts({ run, bugs }: Pick<OverviewProps, 'run' | 'bugs'>) {
	const counts = bugs.phase === 'ready' ? severityCounts(bugs.open) : [];

	return (
		<div className="summary-facts">
			{counts.map((count) => (
				<Pill key={count.label} tone={count.tone} icon={<span aria-hidden className="pill-dot" />}>
					{count.label}
				</Pill>
			))}
			{bugs.phase === 'ready' && counts.length === 0 ? <Pill tone="ok">No open bugs</Pill> : null}
			{run.headSha ? (
				<span className="summary-reviewed">
					Reviewed <span className="mono">{shortSha(run.headSha)}</span>
					{run.finishedAt ? (
						<>
							<span className="meta-sep" />
							<Age at={run.finishedAt} form="long" />
						</>
					) : null}
				</span>
			) : null}
		</div>
	);
}

/** The author's description as a quote under the lede: three lines, the rest behind Show more. */
export function AuthorDescription({ text, by }: { text: string; by: string | null }) {
	return (
		<div className="summary-description">
			<p className="summary-description-label">{by ? `Description · ${author(by).name}` : 'Description'}</p>
			<ClampedText lines={3}>
				<SummaryProse>{text}</SummaryProse>
			</ClampedText>
		</div>
	);
}
