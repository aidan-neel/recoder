'use client';

import type { PullAttachment } from '@recoder/shared';
import { useCallback, useState } from 'react';

import { useApi, useInboxStore } from '../api/client';
import { failureText } from '../api/http';
import { errorToast } from '../shell/notify';
import { useDock } from './dock-store';
import { useDraftAttachments } from './draft-attachments';

/**
 * Opens the conversation with an account in the floating message window, made on first use, with `attach` waiting in its
 * composer. `opening` is true while the server makes it; a refusal shows as a toast.
 */
export function useOpenConversation(): {
	open: (accountId: string, attach?: PullAttachment) => Promise<void>;
	opening: boolean;
} {
	const client = useApi();
	const inbox = useInboxStore();
	const attachTo = useDraftAttachments((state) => state.attach);
	const [opening, setOpening] = useState(false);

	const open = useCallback(
		async (accountId: string, attach?: PullAttachment) => {
			setOpening(true);

			try {
				const conversation = await client.messages.start(accountId);

				inbox.keep(conversation);

				if (attach) attachTo(conversation.id, attach);

				useDock.getState().openConversation(conversation.id);
			} catch (error) {
				errorToast('The conversation did not open.', failureText(error));
			} finally {
				setOpening(false);
			}
		},
		[client, inbox, attachTo]
	);

	return { open, opening };
}
