import type { UsageReport } from '@recoder/shared';

import { kindRows } from '@/lib/usage/usage-rows';

import { UsageBlock } from './usage-block';
import { UsageRows } from './usage-rows';

/** What the model calls went to: reviews, chats and everything else, in the Breakdown's rows. */
export function UsageKinds({ report }: { report: UsageReport }) {
	return (
		<UsageBlock title="By kind">
			<UsageRows rows={kindRows(report)} nameHeading="Kind" aria-label="Tokens by kind" />
		</UsageBlock>
	);
}
