'use client';

import { isBotLogin, type PersonProfile, type PullPage } from '@recoder/shared';
import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	writeClipboard
} from '@recoder/ui';
import { ChatsCircleIcon, DotsThreeIcon, GitBranchIcon, LinkSimpleIcon } from '@phosphor-icons/react';

import { useApi, useProfileCache } from '@/lib/api/client';
import { failureText } from '@/lib/api/http';
import { useOpenConversation } from '@/lib/messages/open-conversation';
import { displayName } from '@/lib/people/refs';
import { usePersonRef } from '@/lib/people/use-person-ref';
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

/** Why the author can't be messaged, from their profile; null when they can. */
function refusal(profile: PersonProfile): string | null {
	const name = displayName(profile.person);

	if (profile.canMessage) return null;
	if (profile.person.bot) return `${name} is a bot, so it can’t be messaged.`;
	if (profile.membership.status === 'member') return 'You wrote this pull request.';
	if (profile.membership.status === 'removed') return `${name} was removed from this server.`;

	return `${name} hasn’t signed in to this Recoder server yet. Copy the invite link from their profile.`;
}

/**
 * Opens the conversation with the pull request's author with the pull request attached, once their profile says they
 * can be messaged; otherwise a toast says why. A bot, or a pull request in a local repository, has no author to message.
 */
function useMessageAuthor(page: PullPage): { warm: () => void; message: () => void } | null {
	const profiles = useProfileCache();
	const conversation = useOpenConversation();
	const person = usePersonRef(page.repoId, page.pull.author);

	if (!person || isBotLogin(person.login)) return null;

	return {
		warm: () => profiles.warm(person),
		message() {
			profiles.read(person).then(
				(profile) => {
					const why = refusal(profile);

					if (why) errorToast('The author can’t be messaged', why);
					else if (profile.membership.status === 'member')
						void conversation.open(profile.membership.accountId, {
							kind: 'pull',
							repoId: page.repoId,
							number: page.pull.number
						});
				},
				(error: unknown) => errorToast('The author’s profile did not load', failureText(error))
			);
		}
	};
}

/**
 * The pull request's own menu beside the merge button: message its author about it, copy its branch name, or copy
 * the link to this page.
 */
export function PullMenu({ page }: { page: PullPage }) {
	const { base } = useApi();
	const href = pullHref(base, page.repoId, page.pull.number);
	const author = useMessageAuthor(page);

	return (
		<DropdownMenu onOpenChange={(open) => open && author?.warm()}>
			<DropdownMenuTrigger>
				<Button variant="ghost" size="icon" aria-label={`More for #${page.pull.number}`}>
					<DotsThreeIcon />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				{author ? (
					<DropdownMenuItem icon={<ChatsCircleIcon />} onSelect={author.message}>
						Message author
					</DropdownMenuItem>
				) : null}
				<DropdownMenuItem icon={<GitBranchIcon />} onSelect={() => copyBranch(page.pull.headRef)}>
					Copy branch name
				</DropdownMenuItem>
				<DropdownMenuItem icon={<LinkSimpleIcon />} onSelect={() => copyLink(new URL(href, location.origin).href)}>
					Copy link
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
