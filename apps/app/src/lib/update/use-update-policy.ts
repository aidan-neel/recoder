'use client';

import type { UpdatePolicy } from '@recoder/shared';
import { useState } from 'react';

import { useApi } from '../api/client';
import { failureText } from '../api/http';
import { useServerRead } from '../server/use-server-read';

/** How a container install updates on its own, saved as each control changes. */
export interface UpdatePolicyView {
	policy: UpdatePolicy | null;
	change: (policy: UpdatePolicy) => void;
	/** Why the last change was refused; the controls are back where they were. */
	refused: string | null;
}

/** Reads the update policy, and saves each change at once, putting it back if the server refuses it. */
export function useUpdatePolicy(): UpdatePolicyView {
	const { update } = useApi();
	const read = useServerRead(update.policy, 'The update settings did not load.');
	const [refused, setRefused] = useState<string | null>(null);

	return {
		policy: read.data,
		refused,
		change: (policy) => {
			const before = read.data;

			read.take(policy);
			setRefused(null);

			update.setPolicy(policy).then(read.take, (failure: unknown) => {
				if (before) read.take(before);
				setRefused(failureText(failure, 'The change was not saved.'));
			});
		}
	};
}
