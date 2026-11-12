'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useApi } from '@/lib/api/client';
import { pullHref } from '@/lib/shell/routes';

import { PageMissing } from '@/components/common/page-missing';

/**
 * A review's old address. Reviews now live on their pull request's page, so
 * this opens that page on its Bugs tab, and shows the missing page when no
 * such review can be read.
 */
export function ReviewRedirect({ id }: { id: string }) {
	const client = useApi();
	const router = useRouter();
	const [missing, setMissing] = useState(false);

	useEffect(() => {
		let current = true;

		client.review(id).then(
			(review) => {
				if (current) router.replace(pullHref(client.base, review.repoId, review.prNumber, 'bugs'));
			},
			() => {
				if (current) setMissing(true);
			}
		);

		return () => {
			current = false;
		};
	}, [client, id, router]);

	return missing ? <PageMissing /> : null;
}
