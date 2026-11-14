import { AgentMark } from '@recoder/ui';

import type { RowLead as Lead } from '@/lib/usage/usage-rows';

import { Avatar } from '@/components/common/avatar';

/** What leads a usage row: a model's provider mark, a person's avatar, or nothing for a day or a folded row. */
export function RowLead({ lead }: { lead: Lead }) {
	if (lead.kind === 'model') return <AgentMark agent={lead.provider} />;
	if (lead.kind === 'person') return <Avatar name={lead.login} src={lead.avatarUrl} />;

	return null;
}
