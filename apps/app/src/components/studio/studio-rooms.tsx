'use client';

import { Card, Icon, Pill } from '@recoder/ui';
import type { CSSProperties } from 'react';

import { plural } from '@/lib/shell/format';
import type { StudioFile, StudioRoom } from '@/lib/studio/studio-view';

import { Bench } from './studio-facilities';

/** How many folders get a room of their own; the rest share one tile. */
const ROOM_CAP = 8;

/** Desks a room draws before it counts the rest. */
const DESK_CAP = 24;

function baseName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

/** A desk: the file's name and a meter of the hunks read, both from the plan and the diff reads. */
function Desk({ file, small }: { file: StudioFile; small: boolean }) {
	const share = file.hunks ? file.read / file.hunks : file.done ? 1 : 0;
	const label = file.hunks ? `${file.path} · ${file.read} of ${file.hunks} hunks read` : file.path;

	return (
		<div
			className="studio-desk"
			data-spot={`desk:${file.path}`}
			data-small={small || undefined}
			data-done={file.done || undefined}
			style={{ '--share': share } as CSSProperties}
			title={label}
			aria-label={label}
			role="img"
		>
			{small ? null : <span className="studio-desk-name">{baseName(file.path)}</span>}
			<span className="studio-desk-meter" />
		</div>
	);
}

function Room({ room, small }: { room: StudioRoom; small: boolean }) {
	const read = room.files.reduce((sum, file) => sum + file.read, 0);
	const hunks = room.files.reduce((sum, file) => sum + file.hunks, 0);
	const rest = room.files.length - DESK_CAP;

	return (
		<Card
			as="section"
			className="studio-room"
			aria-label={room.folder}
			data-done={room.done || undefined}
			style={{ '--grow': Math.min(room.files.length, 6) } as CSSProperties}
		>
			<header className="studio-room-head">
				<span className="studio-room-name">{room.folder}</span>
				{room.done ? <Icon name="check" size={12} className="studio-room-check" aria-label="Read" /> : null}
				<span className="meta tabular">{hunks ? `${read}/${hunks}` : plural(room.files.length, 'file')}</span>
			</header>
			<div className="studio-desks" data-small={small || undefined}>
				{room.files.slice(0, DESK_CAP).map((file) => (
					<Desk key={file.path} file={file} small={small} />
				))}
				{rest > 0 ? <span className="meta studio-desks-rest">+{rest}</span> : null}
			</div>
		</Card>
	);
}

/** The folders past the cap, as one tile the characters in them stand in. */
function MoreRooms({ rooms, rows }: { rooms: StudioRoom[]; rows: number }) {
	const files = rooms.reduce((sum, room) => sum + room.files.length, 0);

	return (
		<Card as="section" className="studio-room studio-more" aria-label="More folders">
			<header className="studio-room-head">
				<span className="studio-room-name">+{plural(rooms.length, 'more folder')}</span>
				<span className="meta tabular">{plural(files, 'file')}</span>
			</header>
			<Bench spot="more" rows={Math.max(1, rows)} />
		</Card>
	);
}

/** The files with a desk on the floor: those the shown rooms draw, since the rest fold into a count or a tile. */
export function shownFiles(rooms: StudioRoom[]): Set<string> {
	return new Set(rooms.slice(0, ROOM_CAP).flatMap((room) => room.files.slice(0, DESK_CAP).map((file) => file.path)));
}

/** A finished review's rooms: one row of folder chips, each checked once every file in it was read. */
function RoomChips({ rooms }: { rooms: StudioRoom[] }) {
	const rest = rooms.length - ROOM_CAP;

	return (
		<ul className="studio-room-chips" aria-label="Folders">
			{rooms.slice(0, ROOM_CAP).map((room) => (
				<li key={room.folder}>
					<Pill
						face="code"
						icon={<Icon name={room.done ? 'check' : 'folder'} size={12} />}
						tone={room.done ? 'ok' : 'neutral'}
					>
						{room.folder}
					</Pill>
				</li>
			))}
			{rest > 0 ? <li className="meta">+{plural(rest, 'more folder')}</li> : null}
		</ul>
	);
}

/**
 * The folders of the plan as rooms of desks, the first `ROOM_CAP` on their
 * own and the rest in one tile; once the review ends they fold to a row of
 * chips so the commons and its findings move up.
 */
export function StudioRooms({ rooms, ended, moreRows }: { rooms: StudioRoom[]; ended: boolean; moreRows: number }) {
	if (ended) return <RoomChips rooms={rooms} />;

	const shown = rooms.slice(0, ROOM_CAP);
	const small = shown.reduce((sum, room) => sum + Math.min(room.files.length, DESK_CAP), 0) > 60;

	return (
		<div className="studio-rooms">
			{shown.map((room) => (
				<Room key={room.folder} room={room} small={small} />
			))}
			{rooms.length > ROOM_CAP ? <MoreRooms rooms={rooms.slice(ROOM_CAP)} rows={moreRows} /> : null}
		</div>
	);
}
