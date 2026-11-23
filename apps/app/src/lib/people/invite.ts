import { writeClipboard } from '@recoder/ui';

import { errorToast, undoToast } from '../shell/notify';

/**
 * Copies this server's address, where someone signs in with GitHub or GitLab and becomes a member. Nothing is held
 * for them until they do, so the link is the whole invitation.
 */
export function copyInvite(base: string): void {
	const url = new URL(base || '/', location.origin).href;

	void writeClipboard(url).then(
		() => undoToast('Invite link copied', undefined, 'They join by signing in with GitHub or GitLab.'),
		() => errorToast('Couldn’t copy the invite link')
	);
}
