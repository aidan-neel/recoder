import type { ReportPerson } from '@recoder/shared';
import { Button, Icon, Pill } from '@recoder/ui';

import { Avatar } from '@/components/common/avatar';

interface UsagePersonHeaderProps {
	person: ReportPerson;
	onBack: () => void;
}

/** The top of one person's view, where the update strip sits for everyone: the way back, then who they are. */
export function UsagePersonHeader({ person, onBack }: UsagePersonHeaderProps) {
	return (
		<header className="usage-person-head">
			<Button variant="ghost" onClick={onBack} data-usage-back>
				<Icon name="arrow_back" />
				Everyone
			</Button>
			<div className="usage-person-id">
				<Avatar name={person.login} src={person.avatarUrl} />
				<h2 className="usage-person-name">{person.login}</h2>
				<Pill>{person.role === 'admin' ? 'Admin' : 'Member'}</Pill>
				<Pill face="code">{person.host ?? person.provider}</Pill>
			</div>
		</header>
	);
}
