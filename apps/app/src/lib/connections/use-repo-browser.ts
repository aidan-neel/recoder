'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

import { useConnections } from './connections-store';
import { signedInForges } from './forges';
import { useAddByUrl, type AddByUrl } from './use-add-by-url';
import { useRemoteList, type RemoteListView } from './use-remote-list';
import { useTokenDialog, type TokenDialog } from './use-token-dialog';

/** Everything the repository browser's shell needs: whether a forge is signed in, and where focus lands on open. */
export interface RepoBrowser {
	/** At least one forge is signed in; the search is off and the URL field takes focus until then. */
	signedIn: boolean;
	/** The Add by URL field; the shell focuses it on open while no forge is signed in. */
	urlField: RefObject<HTMLInputElement | null>;
	/** The dialog's onOpenAutoFocus: moves focus to the URL field while no forge is signed in. */
	onOpenAutoFocus: (event: { preventDefault(): void }) => void;
}

/**
 * The repository browser dialog's shell. Call it in the component that owns
 * the dialog's `open` prop; `useRepoBrowserBody` goes inside the content,
 * which mounts fresh per opening.
 */
export function useRepoBrowser(): RepoBrowser {
	const signedIn = useConnections((state) => signedInForges(state.auth).length > 0);
	const urlField = useRef<HTMLInputElement | null>(null);

	function onOpenAutoFocus(event: { preventDefault(): void }): void {
		if (signedIn || !urlField.current) return;

		event.preventDefault();
		urlField.current.focus();
	}

	return { signedIn, urlField, onOpenAutoFocus };
}

/** Everything the browser's body shows and does, fresh each time the dialog opens. */
export interface RepoBrowserBody {
	query: string;
	setQuery: (query: string) => void;
	/** The token dialog state; `token.connect` opens it for a forge, `token.dialog`'s data drives the modal. */
	token: TokenDialog;
	/** The Add by URL field's state. */
	url: AddByUrl;
	/** The remote repository list's state. */
	remote: RemoteListView;
}

/**
 * The repository browser's body: the search, the forge repository lists, the
 * Add by URL field and the token dialog. Mount it inside the dialog's
 * content so each opening starts with an empty search, fresh forge checks
 * and lists, and no check or timer from an earlier opening.
 */
export function useRepoBrowserBody(): RepoBrowserBody {
	const [query, setQuery] = useState('');
	const token = useTokenDialog();
	const url = useAddByUrl();
	const remote = useRemoteList(query);

	useEffect(() => {
		void useConnections.getState().loadAuth();
		void useConnections.getState().loadRepos();
	}, []);

	return { query, setQuery, token, url, remote };
}
