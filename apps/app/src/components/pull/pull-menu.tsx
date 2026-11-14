'use client';

import type { PullPage } from '@recoder/shared';
import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	writeClipboard
} from '@recoder/ui';
import { Ellipsis, GitBranch, Link2 } from 'lucide-react';

import { useApi } from '@/lib/api/client';
import { copyLink } from '@/lib/shell/copy-link';
import { errorToast, undoToast } from '@/lib/shell/notify';
import { pullHref } from '@/lib/shell/routes';

/** Copies the branch the pull request comes from, to check it out by name. */
function copyBranch(name: string): void {
	void writeClipboard(name).then(
		() => undoToast('Branch name copied'),
		() => errorToast('Couldn’t copy the branch name')
	);
}

/** The pull request's own menu in the merge strip: copy its branch name or the link to this page. */
export function PullMenu({ page }: { page: PullPage }) {
	const { base } = useApi();
	const href = pullHref(base, page.repoId, page.pull.number);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger>
				<Button variant="ghost" size="icon" aria-label={`More for #${page.pull.number}`}>
					<Ellipsis />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem icon={<GitBranch />} onSelect={() => copyBranch(page.pull.headRef)}>
					Copy branch name
				</DropdownMenuItem>
				<DropdownMenuItem icon={<Link2 />} onSelect={() => copyLink(new URL(href, location.origin).href)}>
					Copy link
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
