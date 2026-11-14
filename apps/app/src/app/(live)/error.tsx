'use client';

import { PageError } from '@/components/common/page-error';

interface ErrorProps {
	error: unknown;
	/** Fetches and renders the page again. */
	retry: () => void;
}

export default function LiveError({ error, retry }: ErrorProps) {
	return <PageError error={error} retry={retry} />;
}
