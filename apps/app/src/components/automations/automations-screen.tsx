import { ColumnPage } from '@/components/common/column-page';

import { AutomationsGroups } from './automations-groups';

/** Automations: what starts a review without a click, which repositories it watches, and what it started. */
export function AutomationsScreen() {
	return (
		<ColumnPage title="Automations">
			<AutomationsGroups />
		</ColumnPage>
	);
}
