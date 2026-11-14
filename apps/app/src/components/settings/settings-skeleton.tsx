import { Card, Skeleton, SkeletonRows } from '@recoder/ui';

/** Widths for the name and detail bars of a row, cycled so the rows do not look stamped. */
const ROW_WIDTHS = [
	['128px', '260px'],
	['96px', '220px'],
	['148px', '300px']
] as const;

/** A Settings row's height (`.settings-page .settings-row`). */
export const SETTINGS_ROW_HEIGHT = 52;

/**
 * Stands in for a section while its settings load: the same groups of 52px
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
						<SkeletonRows count={rows} height={SETTINGS_ROW_HEIGHT} widths={ROW_WIDTHS} rowClassName="settings-row" />
					</Card>
				</div>
			))}
		</div>
	);
}
