'use client';

import { Input, Modal, ModalBody, ModalContent, ModalTitle } from '@recoder/ui';
import { Search } from 'lucide-react';

import {
	useRepoBrowser,
	useRepoBrowserBody,
	type RepoBrowser as BrowserShell
} from '@/lib/connections/use-repo-browser';

import { AddByUrl } from './add-by-url';
import { RemoteList } from './remote-list';
import { TokenModal } from './token-modal';

/** The dialog's body. It mounts once per opening, so the search starts empty and the forges are checked again. */
function BrowserBody({ shell }: { shell: BrowserShell }) {
	const body = useRepoBrowserBody();

	return (
		<ModalBody className="repo-browser">
			<Input
				value={body.query}
				leading={<Search aria-hidden />}
				placeholder="Search repositories"
				aria-label="Search repositories"
				autoComplete="off"
				spellCheck={false}
				disabled={!shell.signedIn}
				onChange={(event) => body.setQuery(event.target.value)}
			/>
			<div className="remote-frame" aria-busy={body.remote.kind === 'checking' || body.remote.kind === 'loading'}>
				<RemoteList view={body.remote} onConnect={body.token.connect} />
			</div>
			<AddByUrl url={body.url} inputRef={shell.urlField} />
			<TokenModal dialog={body.token} />
		</ModalBody>
	);
}

interface RepoBrowserProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

/**
 * Picks repositories to track: the ones the signed-in forges can see, with a
 * search and the tracked ones marked, and Add by URL for any other. While no
 * forge is signed in the search is off and the dialog opens on the URL field.
 */
export function RepoBrowser({ open, onOpenChange }: RepoBrowserProps) {
	const shell = useRepoBrowser();

	return (
		<Modal open={open} onOpenChange={onOpenChange}>
			<ModalContent onOpenAutoFocus={shell.onOpenAutoFocus}>
				<ModalTitle>Add repository</ModalTitle>
				<BrowserBody shell={shell} />
			</ModalContent>
		</Modal>
	);
}
