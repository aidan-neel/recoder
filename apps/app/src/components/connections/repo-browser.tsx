'use client';

import { Input, Modal, ModalBody, ModalContent, ModalTitle } from '@recoder/ui';
import { Search } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';

import { useConnections } from '@/lib/connections/connections-store';
import { signedInForges } from '@/lib/connections/forges';

import { AddByUrl } from './add-by-url';
import { RemoteList } from './remote-list';
import { useTokenDialog } from './use-token-dialog';

interface RepoBrowserProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

interface BrowserBodyProps {
	signedIn: boolean;
	urlField: RefObject<HTMLInputElement | null>;
}

/** The dialog's body, mounted once per opening so the search starts empty and the forges are checked afresh. */
function BrowserBody({ signedIn, urlField }: BrowserBodyProps) {
	const [query, setQuery] = useState('');
	const token = useTokenDialog();

	useEffect(() => {
		void useConnections.getState().loadAuth();
		void useConnections.getState().loadRepos();
	}, []);

	return (
		<ModalBody className="repo-browser">
			<Input
				value={query}
				leading={<Search aria-hidden />}
				placeholder="Search repositories"
				aria-label="Search repositories"
				autoComplete="off"
				spellCheck={false}
				disabled={!signedIn}
				onChange={(event) => setQuery(event.target.value)}
			/>
			<div className="remote-frame">
				<RemoteList query={query} onConnect={token.connect} />
			</div>
			<AddByUrl inputRef={urlField} />
			{token.dialog}
		</ModalBody>
	);
}

/**
 * Pick repositories to track: what the signed-in forges can see, searchable,
 * with tracked ones marked, plus Add by URL for anything else. With no forge
 * signed in the search is off, so the dialog opens on the URL field instead.
 */
export function RepoBrowser({ open, onOpenChange }: RepoBrowserProps) {
	const signedIn = useConnections((state) => signedInForges(state.auth).length > 0);
	const urlField = useRef<HTMLInputElement>(null);

	return (
		<Modal open={open} onOpenChange={onOpenChange}>
			<ModalContent
				onOpenAutoFocus={(event) => {
					if (signedIn || !urlField.current) return;

					event.preventDefault();
					urlField.current.focus();
				}}
			>
				<ModalTitle>Add repository</ModalTitle>
				<BrowserBody signedIn={signedIn} urlField={urlField} />
			</ModalContent>
		</Modal>
	);
}
