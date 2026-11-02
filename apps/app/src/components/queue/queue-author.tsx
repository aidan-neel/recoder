import { Bot } from 'lucide-react';

import { author } from '@/lib/shell/format';

/** Who opened the pull request, with a bot mark when an agent did: in queue rows and the review bar's rows. */
export function QueueAuthor({ login }: { login: string }) {
	const by = author(login);

	return (
		<span className="queue-row-author" title={by.agent ? `${by.name}, an agent` : by.name}>
			{by.agent ? <Bot size={12} strokeWidth={1.75} aria-hidden /> : null}
			{by.name}
		</span>
	);
}
