import { Skeleton } from '@recoder/ui';

/** The old app's five placeholder rows: a title line and a meta line half as long plus a bit. */
const ROWS = [
	{ title: 'w-[52%]', meta: 'w-[36%]' },
	{ title: 'w-[38%]', meta: 'w-[29%]' },
	{ title: 'w-[46%]', meta: 'w-[33%]' },
	{ title: 'w-[30%]', meta: 'w-[25%]' },
	{ title: 'w-[42%]', meta: 'w-[31%]' }
];

/** The queue while it loads: the headline and five rows. Rows and dividers stay invisible for 200ms, so a fast load never flashes them. */
export function QueueSkeleton() {
	return (
		<div className="queue-skeleton" aria-busy="true" aria-label="Loading pull requests">
			<div className="queue-brief">
				<Skeleton className="h-[27px] w-[62%]" />
			</div>
			<div className="queue-skeleton-list">
				{ROWS.map((row) => (
					<div key={row.title} className="queue-row">
						<Skeleton className="size-4 rounded-full" />
						<span className="flex flex-1 flex-col gap-2">
							<Skeleton className={`h-3 ${row.title}`} />
							<Skeleton className={`h-2.5 ${row.meta}`} />
						</span>
					</div>
				))}
			</div>
		</div>
	);
}
