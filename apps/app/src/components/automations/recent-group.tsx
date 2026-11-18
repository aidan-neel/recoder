'use client';

import type { Repo } from '@recoder/shared';
import { HoverList, RowButton } from '@recoder/ui';
import { CaretRightIcon } from '@phosphor-icons/react';

import { useRecentActivity, type RecentRow } from '@/lib/settings/use-activity';

import { Link } from '@/components/common/link';
import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';

/** One review the watcher started. The whole row opens its pull request. */
function RecentLink({ row }: { row: RecentRow }) {
	return (
		<li className="automations-link-row">
			<SettingsRow
				name={
					<RowButton asChild cover>
						<Link href={row.href}>{row.name}</Link>
					</RowButton>
				}
				detail={row.description}
			>
				<CaretRightIcon aria-hidden />
			</SettingsRow>
		</li>
	);
}

/** Automations → Recent: the latest reviews the watcher started, newest first. */
export function RecentGroup({ repos }: { repos: Repo[] }) {
	const { rows } = useRecentActivity(repos);

	return (
		<SettingsGroup title="Recent">
			{rows.length === 0 ? (
				<div className="settings-row">
					<span className="settings-row-detail">Reviews that start on their own show here</span>
				</div>
			) : (
				<HoverList
					as="ul"
					className="automations-links"
					itemSelector=".automations-link-row"
					aria-label="Reviews started on their own"
				>
					{rows.map((row) => (
						<RecentLink key={row.reviewId} row={row} />
					))}
				</HoverList>
			)}
		</SettingsGroup>
	);
}
