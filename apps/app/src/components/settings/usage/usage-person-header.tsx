import type { UsagePerson } from '@recoder/shared';
import { Button, Pill } from '@recoder/ui';
import { ArrowLeft } from 'lucide-react';

import { Avatar } from '@/components/common/avatar';

interface UsagePersonHeaderProps {
	person: UsagePerson;
	onBack: () => void;
}

/** The top of one person's view, where the update strip sits for everyone: the way back, then who they are. */
export function UsagePersonHeader({ person, onBack }: UsagePersonHeaderProps) {
	return (
		<header className="usage-person-head">
			<Button variant="ghost" onClick={onBack} data-usage-back>
				<ArrowLeft aria-hidden />
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
