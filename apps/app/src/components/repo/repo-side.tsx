'use client';

import { ChartTip, HoverList, Meter, RowButton, Tooltip } from '@recoder/ui';
import { BookOpen, ChevronRight, Clock } from 'lucide-react';

import type { HotspotRow, RepoPageData, ReviewChart as ReviewChartView } from '@/lib/repo/types';
import { plural } from '@/lib/shell/format';
import { AUTOMATIONS_HREF, GUIDELINES_HREF } from '@/lib/shell/routes';

import { Link } from '@/components/common/link';

import { RepoEmpty, RepoSection } from './repo-section';
import { ReviewBar } from './review-bar';

/** A bar a day: the reviews in grey, the part that found a bug in the high-severity colour. A tip names the day. */
function ReviewChart({ chart }: { chart: ReviewChartView }) {
	const legend = (
		<ul className="repo-legend" aria-hidden>
			<li>
				<span className="repo-swatch" data-part="reviews" />
				Reviews
			</li>
			<li>
				<span className="repo-swatch" data-part="bugs" />
				Found bugs
			</li>
		</ul>
	);

	return (
		<RepoSection title={chart.title} aside={legend} className="repo-chart-section">
			<div className="repo-chart" role="img" aria-label={chart.summary}>
				{chart.bars.map((bar) => (
					<Tooltip
						key={bar.day}
						side="top"
						content={
							<ChartTip
								heading={bar.label}
								value={plural(bar.reviews, 'review')}
								rows={[{ id: 'bugs', label: 'Found bugs', value: String(bar.withBugs) }]}
							/>
						}
					>
						<ReviewBar bar={bar} />
					</Tooltip>
				))}
				{chart.empty ? <span className="repo-chart-empty">{chart.empty}</span> : null}
			</div>
			<div className="repo-axis" aria-hidden>
				<span>{chart.first}</span>
				<span>{chart.last}</span>
			</div>
		</RepoSection>
	);
}

/** The directories holding the most bugs, each with a share line against the first. */
function Hotspots({ rows, window }: { rows: HotspotRow[]; window: string }) {
	return (
		<RepoSection title="Where bugs land" aside={<span className="meta">{window}</span>}>
			{rows.length === 0 ? (
				<RepoEmpty>{`No bugs found in ${window}.`}</RepoEmpty>
			) : (
				<ul className="repo-rows">
					{rows.map((row) => (
						<li key={row.path} className="repo-row repo-hotspot">
							<span className="repo-hotspot-path" title={row.path}>
								{row.path}
							</span>
							<Meter value={row.share} className="repo-hotspot-share" aria-label={`${row.path}, share of bugs`} />
							<span className="repo-hotspot-count">{row.findings}</span>
						</li>
					))}
				</ul>
			)}
		</RepoSection>
	);
}

const SETUP = [
	{ id: 'guidelines', label: 'Guidelines', href: GUIDELINES_HREF, icon: BookOpen },
	{ id: 'automations', label: 'Automations', href: AUTOMATIONS_HREF, icon: Clock }
] as const;

/** Where the repository's reviews are shaped: its guidelines and the automations that start them. */
function SetUp() {
	return (
		<RepoSection title="Set up here">
			<HoverList as="ul" className="repo-rows" itemSelector="[data-repo-row]" aria-label="Set up here">
				{SETUP.map(({ id, label, href, icon: Icon }) => (
					<li key={id} data-repo-row className="repo-row">
						<RowButton asChild cover>
							<Link href={href} className="repo-row-link">
								<Icon aria-hidden className="repo-setup-icon" />
								<span className="repo-row-title">{label}</span>
								<ChevronRight aria-hidden className="repo-setup-chevron" />
							</Link>
						</RowButton>
					</li>
				))}
			</HoverList>
		</RepoSection>
	);
}

/** The narrow column: the month's reviews, where bugs land, and where to set the repository up. */
export function RepoSide({ data }: { data: RepoPageData }) {
	return (
		<div className="repo-side">
			<ReviewChart chart={data.chart} />
			<Hotspots rows={data.hotspots} window={data.window} />
			<SetUp />
		</div>
	);
}
