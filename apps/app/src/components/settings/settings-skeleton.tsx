import { Card, cn, Skeleton } from '@recoder/ui';

/** Widths for each placeholder row's name and description, so the rows don't read as copies. */
const WIDTHS = [
	['w-[24%]', 'w-[46%]'],
	['w-[30%]', 'w-[38%]'],
	['w-[20%]', 'w-[42%]'],
	['w-[28%]', 'w-[34%]'],
	['w-[22%]', 'w-[40%]']
];

/** A group's stand-in: a title bar over a card of rows. */
function GroupSkeleton({ rows, offset = 0 }: { rows: number; offset?: number }) {
	return (
		<div className="settings-group">
			<div className="settings-group-head">
				<Skeleton className="h-3 w-16" />
			</div>
			<Card className="settings-list">
				{Array.from({ length: rows }, (_, row) => {
					const [name, description] = WIDTHS[(row + offset) % WIDTHS.length];

					return (
						<div key={row} className="settings-row">
							<div className="flex min-w-0 flex-1 flex-col gap-2">
								<Skeleton className={cn('h-3', name)} />
								<Skeleton className={cn('h-2.5', description)} />
							</div>
							<Skeleton className="h-3 w-24" />
						</div>
					);
				})}
			</Card>
		</div>
	);
}

/**
 * A section's shape while its settings load: the same groups and rows, so
 * the page swaps in place with nothing moving. `groups` lists each group's
 * row count.
 */
export function SettingsSkeleton({ groups }: { groups: readonly number[] }) {
	return (
		<div role="status" aria-label="Loading settings" className="settings-stack">
			{groups.map((rows, group) => (
				<GroupSkeleton key={group} rows={rows} offset={group * 2} />
			))}
		</div>
	);
}
