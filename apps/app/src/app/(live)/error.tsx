'use client';

import { PageError } from '@/components/common/page-error';

interface ErrorProps {
	error: unknown;
	/** Fetches and renders the page again. */
	retry: () => void;
}

export default function LiveError({ retry }: ErrorProps) {
	return <PageError retry={retry} />;
}
