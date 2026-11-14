'use client';

import type { Member } from '@recoder/shared';
import { Button, ConfirmDialog, ForgeMark, Pill } from '@recoder/ui';
import { X } from 'lucide-react';
import { useRef, type Ref } from 'react';

import { forgeLabel } from '@/lib/connections/forges';
import { mention, useRemoveMember } from '@/lib/members/use-remove-member';

import { Avatar } from '@/components/common/avatar';

import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';

/** The badge the admin's row carries; a member's row has none. */
function RoleBadge({ member }: { member: Member }) {
	return member.role === 'admin' ? <Pill>Admin</Pill> : null;
}

/** The forge's mark, the `@login` the name above does not already say, and the host of a self-managed GitLab. */
function MemberHandle({ member }: { member: Member }) {
	return (
		<span className="member-handle">
			<ForgeMark provider={member.provider} />
			{member.name ? mention(member) : forgeLabel(member.provider)}
			{member.host ? ` · ${member.host}` : null}
		</span>
	);
}

interface MemberRowProps {
	member: Member;
	onRemove: (member: Member) => void;
	/** The row's Remove button, so focus can land on a neighbour's once this row is gone. */
	removeRef: Ref<HTMLButtonElement>;
}

/** One person: who they are on the left, and on hover or focus a quiet Remove, which the admin's row never has. */
function MemberRow({ member, onRemove, removeRef }: MemberRowProps) {
	return (
		<SettingsRow
			leading={<Avatar name={member.name ?? member.login} src={member.avatarUrl} shape="square" />}
			name={
				<span className="member-name">
					{member.name ?? mention(member)}
					<RoleBadge member={member} />
				</span>
			}
			detail={<MemberHandle member={member} />}
		>
			{member.role === 'admin' ? null : (
				<Button
					ref={removeRef}
					variant="ghost"
					size="icon"
					className="member-remove"
					aria-label={`Remove ${mention(member)}`}
					onClick={() => onRemove(member)}
				>
					<X aria-hidden />
				</Button>
			)}
		</SettingsRow>
	);
}

/**
 * The Remove button to focus once the person at `index` is gone: the row that took their place, else the one above.
 * The admin's row has none, so with nobody else left focus stays where the dialog leaves it.
 */
function neighbourAfterRemoval(
	members: Member[],
	index: number,
	buttons: Map<string, HTMLButtonElement>
): HTMLButtonElement | undefined {
	const neighbour = members[index] ?? members[index - 1];

	return neighbour ? buttons.get(neighbour.key) : undefined;
}

/** Admin → People: the admin, then everyone who has signed in. Removing asks first. */
export function MemberList({ members }: { members: Member[] }) {
	const removal = useRemoveMember();
	const removeButtons = useRef(new Map<string, HTMLButtonElement>());
	const askedIndex = useRef(0);

	function ask(member: Member): void {
		askedIndex.current = members.findIndex((item) => item.key === member.key);
		removal.ask(member);
	}

	return (
		<SettingsGroup title="People">
			{members.map((member) => (
				<MemberRow
					key={member.key}
					member={member}
					onRemove={ask}
					removeRef={(button) => {
						if (button) removeButtons.current.set(member.key, button);
						else removeButtons.current.delete(member.key);
					}}
				/>
			))}
			<ConfirmDialog
				open={removal.open}
				onOpenChange={removal.setOpen}
				title={`Remove ${removal.target ? mention(removal.target) : 'this person'}?`}
				description="They’re signed out and can’t sign in to this server again."
				confirmLabel="Remove"
				destructive
				onConfirm={removal.confirm}
				onCloseAutoFocus={(event) => {
					if (!removal.target || members.some((member) => member.key === removal.target?.key)) return;

					const neighbour = neighbourAfterRemoval(members, askedIndex.current, removeButtons.current);

					if (!neighbour) return;

					event.preventDefault();
					neighbour.focus();
				}}
			/>
		</SettingsGroup>
	);
}
