import { AgentMark, ForgeMark } from '@recoder/ui';

import type { RowLead as Lead } from '@/lib/usage/report-shared';

import { Avatar } from '@/components/common/avatar';

/** What leads a report row: a model's provider, a repository's forge, a person's avatar, or nothing. */
export function RowLead({ lead }: { lead: Lead }) {
	if (lead.kind === 'model') return <AgentMark agent={lead.provider} />;
	if (lead.kind === 'repo') return <ForgeMark provider={lead.provider} />;
	if (lead.kind === 'person') return <Avatar name={lead.login} src={lead.avatarUrl} />;

	return null;
}
