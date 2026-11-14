'use client';

import type { Member } from '@recoder/shared';
import { useState } from 'react';

import { useApi } from '../api/client';
import { undoToast } from '../shell/notify';
import { useMembers } from './members-store';

/** The remove confirm dialog's state and its confirm action. */
export interface MemberRemoval {
	/** The person the dialog asks about; it keeps them while it closes. Null before the first ask. */
	target: Member | null;
	open: boolean;
	setOpen: (open: boolean) => void;
	/** Opens the confirm for a person. */
	ask: (member: Member) => void;
	/** Removes the target; rejects with the plain reason the dialog shows. */
	confirm: () => Promise<void>;
}

/** What a member is called in a sentence: `@login`. */
export function mention(member: Pick<Member, 'login'>): string {
	return `@${member.login}`;
}

/** The "Remove @login?" confirm behind each member row. */
export function useRemoveMember(): MemberRemoval {
	const { members: api } = useApi();
	const [target, setTarget] = useState<Member | null>(null);
	const [open, setOpen] = useState(false);

	function ask(member: Member): void {
		setTarget(member);
		setOpen(true);
	}

	async function confirm(): Promise<void> {
		if (!target) return;

		await useMembers.getState().remove(api, target);
		undoToast(`Removed ${mention(target)}`);
	}

	return { target, open, setOpen, ask, confirm };
}
