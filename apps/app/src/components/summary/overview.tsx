'use client';

import { ClampedText, Markdown, Pill, SkeletonText } from '@recoder/ui';

import type { BugsView, SummaryView } from '@/lib/bugs/types';
import type { RunView } from '@/lib/run/types';
import { author } from '@/lib/shell/format';
import { severityCounts } from '@/lib/summary/bug-tones';

import { Age } from '@/components/common/age';

/** How many characters of a commit hash name it. */
const SHORT_SHA = 7;

interface OverviewProps {
	summary: SummaryView;
	run: RunView;
	bugs: BugsView;
	/** The pull request author's login; null before the page loads. */
	by: string | null;
	/** True until the review's record arrives: the overview stands as its skeleton. */
	loading: boolean;
}

/**
 * What the change does at a glance: the review's account of it as the lede,
 * shut to its first lines; its open findings as badges with the commit it
 * read; then the author's own description, quieter and shorter. Model and
 * author text show as written, never cut but behind Show more.
 */
export function Overview({ summary, run, bugs, by, loading }: OverviewProps) {
	if (loading) return <OverviewSkeleton />;
	if (!summary.analysis && !summary.description) return null;

	return (
		<section className="summary-overview" aria-label="Overview">
			{summary.analysis ? (
				<>
					<ClampedText lines={4} className="summary-lede">
						<Markdown>{summary.analysis}</Markdown>
					</ClampedText>
					<OverviewFacts run={run} bugs={bugs} />
				</>
			) : null}
			{summary.description ? <Description text={summary.description} by={by} /> : null}
		</section>
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
					Reviewed <span className="mono">{run.headSha.slice(0, SHORT_SHA)}</span>
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
function Description({ text, by }: { text: string; by: string | null }) {
	return (
		<div className="summary-description">
			<p className="summary-description-label">{by ? `Description · ${author(by).name}` : 'Description'}</p>
			<ClampedText lines={3}>
				<Markdown>{text}</Markdown>
			</ClampedText>
		</div>
	);
}

/** Bars where the lede and its badges will stand, exactly as tall, so nothing moves when they arrive. */
function OverviewSkeleton() {
	return (
		<div className="summary-overview" aria-hidden>
			<SkeletonText count={3} lineHeight={24} />
			<SkeletonText count={1} lineHeight={20} widths={['220px']} />
		</div>
	);
}
