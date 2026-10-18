import { writeClipboard } from '@recoder/ui';

import { errorToast, undoToast } from './notify';

/** Copies a pull request's address, and says whether it worked, even where the clipboard API is missing. */
export function copyLink(url: string): void {
	void writeClipboard(url).then(
		() => undoToast('Link copied'),
		() => errorToast('Couldn’t copy the link')
	);
}
