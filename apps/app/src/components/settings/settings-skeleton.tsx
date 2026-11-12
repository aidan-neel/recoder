import { Card, Skeleton, SkeletonRows } from '@recoder/ui';

/** Widths for the name and detail bars of a row, cycled so the rows do not look stamped. */
const ROW_WIDTHS = [
	['128px', '260px'],
	['96px', '220px'],
	['148px', '300px']
] as const;

/**
 * Stands in for a section while its settings load: the same groups of 60px
 * rows that replace it, so nothing moves when they land.
 */
export function SettingsSkeleton({ groups }: { groups: readonly number[] }) {
	return (
		<div className="settings" aria-hidden>
			{groups.map((rows, index) => (
				<div key={index} className="settings-group">
					<div className="settings-group-head">
						<Skeleton style={{ width: 96 }} />
					</div>
					<Card>
						<SkeletonRows count={rows} height={60} widths={ROW_WIDTHS} rowClassName="settings-row" />
					</Card>
				</div>
			))}
		</div>
	);
}
