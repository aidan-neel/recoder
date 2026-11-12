import { ForgeMark } from '@recoder/ui';
import type { ComponentProps } from 'react';

/** A forge's mark on a quiet tile: what leads the row of a forge, or of a repository on one. */
export function ForgeTile({ provider }: Pick<ComponentProps<typeof ForgeMark>, 'provider'>) {
	return (
		<span className="forge-tile">
			<ForgeMark provider={provider} />
		</span>
	);
}
