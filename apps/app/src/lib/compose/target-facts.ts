import type { LinkFacts } from '@recoder/ui/form';

import type { ReadTarget } from '../pulls/pull-target';

/**
 * The facts for the New review field's embeds: the link the target was read
 * from says whether its repository is connected or why it cannot be
 * reviewed; any other link shows what the list knows.
 */
export function targetFacts({ target, reference }: ReadTarget, known: LinkFacts): LinkFacts {
	return (link) => {
		if (link.url !== reference) return known(link);
		if (target.kind === 'untracked') return { status: 'Not connected', tone: 'warning' };
		if (target.kind === 'invalid') return { status: target.reason, tone: 'danger' };

		return known(link);
	};
}
