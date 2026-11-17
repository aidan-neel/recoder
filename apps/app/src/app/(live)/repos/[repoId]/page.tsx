import type { Metadata } from 'next';

import { RepoScreen } from '@/components/repo/repo-screen';

interface RepoPageProps {
	params: Promise<{ repoId: string }>;
}

export const metadata: Metadata = { title: 'Repository' };

export default async function RepoPage({ params }: RepoPageProps) {
	return <RepoScreen repoId={decodeURIComponent((await params).repoId)} />;
}
