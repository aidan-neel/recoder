import { Skeleton } from '@recoder/ui';

import { PanelHeader } from '@/components/common/panel-header';

/** Rail placeholder widths, so the rows read as text of different lengths. */
const ROWS = ['w-[70%]', 'w-[82%]', 'w-[64%]', 'w-[76%]', 'w-[58%]'];

/** The review page while it loads: the header and rail in outline, held invisible for the first 200ms. */
export function ReviewSkeleton() {
	return (
		<div data-ui="review-page" className="review-page" aria-busy>
			<PanelHeader className="gap-3 pl-[18px]">
				<Skeleton className="h-[15px] w-[44px]" />
				<Skeleton className="h-[13px] w-[320px]" />
			</PanelHeader>
			<div className="review-body">
				<div className="rail">
					{ROWS.map((width) => (
						<div key={width} className="rail-row-skeleton">
							<Skeleton className={`h-[11px] ${width}`} />
						</div>
					))}
				</div>
				<div className="review-main" />
			</div>
		</div>
	);
}
