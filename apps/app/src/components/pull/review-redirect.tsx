'use client';

import { useEffect, useState } from 'react';

import { useApi } from '@/lib/api/client';
import { replaceAddress } from '@/lib/shell/navigation';
import { pullHref } from '@/lib/shell/routes';

import { PageMissing } from '@/components/common/page-missing';

/**
 * A review's old address. Reviews now live on their pull request's page, so
 * this opens that page on its Review tab, and shows the missing page when no
 * such review can be read.
 */
export function ReviewRedirect({ id }: { id: string }) {
	const client = useApi();
	const [missing, setMissing] = useState(false);

	useEffect(() => {
		let current = true;

		client.review(id).then(
			(review) => {
				if (current) replaceAddress(pullHref(client.base, review.repoId, review.prNumber, 'review'));
			},
			() => {
				if (current) setMissing(true);
			}
		);

		return () => {
			current = false;
		};
	}, [client, id]);

	return missing ? <PageMissing /> : null;
}
