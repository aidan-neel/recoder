'use client';

import { DEFAULT_SUBAGENT_CAP } from '@recoder/shared';
import { SegmentedControl, Switch } from '@recoder/ui';
import { useRef, type CSSProperties, type ReactNode } from 'react';

import { AddRepository, REPO_ROW_HEIGHT } from '@/components/connections/repo-group';
import { FORGES } from '@/lib/connections/forges';
import {
	countScript,
	countVars,
	heightScript,
	heightVar,
	useBeforeStorage,
	useGroupHeight,
	useRowCount,
	type CountKey,
	type GroupKey
} from '@/lib/settings/last-counts';
import { LIMIT_FIELDS } from '@/lib/settings/limits';
import { ROLE_NAME } from '@/lib/settings/model-options';
import type { SettingsSection } from '@/lib/settings/sections';

import { AddProvider } from './providers/add-provider';
import { CheckAgain } from './providers/check-again';
import { LOW_SEVERITY, MODEL_TEXT, SUBAGENTS, THEME } from './row-copy';
import { SettingsGroup, useFocusHandOff } from './settings-group';
import { CountedRows, Rows, Commands, type EmptyRows, type RowCopy, type RowShape } from './skeleton-rows';

interface GroupShape extends RowShape {
	/** The group's real title, which shows at once and stays put when the rows land. */
	title: string;
	/** The head's button, when it works before the rows load (Check again, Add repository). */
	action?: ReactNode;
	/** For a head button the loaded group shows only while a list has rows (Add provider): that list. */
	actionWhile?: CountKey;
	/** How many rows: a fixed number, or the list whose length at its last load sets it. */
	rows: number | CountKey;
	/**
	 * What a remembered list that was empty shows: `hide` drops the whole
	 * group, which doesn't show without rows; `row` shows one two-line row,
	 * the list's empty state. Otherwise the card is empty.
	 */
	empty?: EmptyRows;
	/** For remembered rows, the count of commands shown under some of them (a CLI to install or sign in). */
	commands?: CountKey;
	/**
	 * Every row's words and control are known before it loads, so its
	 * placeholder rows wrap as the loaded ones do at any width, and a height
	 * kept from another width would only be a worse guess.
	 */
	fixed?: boolean;
}

/** Nothing: the boot frame's head buttons and the hidden controls are inert, so this never runs. */
function noop(): void {}

/** The save slot that sits before a control that saves on change (`SaveStatus`), empty. */
const SAVE_SLOT = <span className="save-status" />;

/** The Reviewers rows at the server's defaults: two subagents, every severity reported. */
const REVIEWER_COPY: readonly RowCopy[] = [
	{
		name: SUBAGENTS.name,
		description: SUBAGENTS.text[DEFAULT_SUBAGENT_CAP],
		control: (
			<>
				{SAVE_SLOT}
				<SegmentedControl
					aria-label={SUBAGENTS.name}
					value={String(DEFAULT_SUBAGENT_CAP)}
					onValueChange={noop}
					options={SUBAGENTS.options}
				/>
			</>
		)
	},
	{
		name: LOW_SEVERITY.name,
		description: LOW_SEVERITY.on,
		control: (
			<>
				{SAVE_SLOT}
				<Switch checked onCheckedChange={noop} aria-label={LOW_SEVERITY.name} />
			</>
		)
	}
];

/** The Models rows, each picker a box of a likely size (`.settings-copy-picker`): the model it names is not known yet. */
const MODEL_COPY: readonly RowCopy[] = (['orchestrator', 'specialist'] as const).map((role) => ({
	name: ROLE_NAME[role],
	description: MODEL_TEXT[role],
	control: <span className="settings-copy-picker" />
}));

/**
 * Each group's placeholder, the one shape its section paints while loading,
 * in the boot frame and the page alike. A section whose head buttons work
 * before its rows land passes live ones in place of the inert ones here.
 */
const GROUP_SKELETONS = {
	agentClis: { title: 'Agent CLIs', rows: 'agents', commands: 'cliCommands', glyph: true, action: <CheckAgain /> },
	providers: {
		title: 'Providers',
		rows: 'providers',
		empty: 'hide',
		action: <AddProvider onAdd={noop} />,
		actionWhile: 'connected'
	},
	models: { title: 'Models', rows: 'models', copy: MODEL_COPY },
	forges: { title: 'Forges', rows: FORGES.length },
	repos: {
		title: 'Repositories',
		rows: 'repos',
		empty: 'row',
		height: REPO_ROW_HEIGHT,
		glyph: true,
		lines: 1,
		action: <AddRepository onAdd={noop} />
	},
	reviewers: { title: 'Reviewers', rows: REVIEWER_COPY.length, copy: REVIEWER_COPY, fixed: true },
	limits: {
		title: 'Review limits',
		rows: LIMIT_FIELDS.length,
		copy: LIMIT_FIELDS.map((field) => ({ name: field.name, description: field.hint, field: true })),
		fixed: true
	},
	storage: { title: 'Storage', rows: 'storage', empty: 'hide' },
	globalGuidelines: { title: 'Global', rows: 1 },
	repoGuidelines: { title: 'Repositories', rows: 'repos', empty: 'row' },
	display: {
		title: 'Display',
		rows: 1,
		copy: [
			{
				name: THEME.name,
				description: THEME.description,
				control: (
					<SegmentedControl aria-label={THEME.name} value="system" onValueChange={noop} options={THEME.options} />
				)
			}
		],
		fixed: true
	}
} satisfies Record<GroupKey, GroupShape>;

/** Each section's groups, top to bottom, as the section paints them before its data lands. */
const SECTION_GROUPS: Record<SettingsSection, readonly GroupKey[]> = {
	agent: ['agentClis', 'providers', 'models'],
	connections: ['forges', 'repos'],
	harness: ['reviewers', 'limits', 'storage'],
	guidelines: ['globalGuidelines', 'repoGuidelines'],
	appearance: ['display']
};

/** Live head buttons by group, for a section that draws its skeleton inside the working page. */
type GroupActions = Partial<Record<GroupKey, ReactNode>>;

/** A head button the loaded group shows only while `list` has rows. */
function ActionWhile({ list, children }: { list: CountKey; children: ReactNode }) {
	const count = useRowCount(list);

	if (count === null) return <span style={{ display: `var(${countVars(list).ifRows}, contents)` }}>{children}</span>;

	return count === 0 ? null : children;
}

interface FrameProps {
	group: GroupKey;
	/** A live head button in place of the shape's inert one. */
	action?: ReactNode;
	/** In the server's HTML, the switch that hides the whole group when its list was empty. */
	hideVar?: string;
	children: ReactNode;
}

/**
 * A placeholder group's title, head button and card, the card as tall as the
 * group was when it last loaded at this window width, or near it
 * (`--settings-height`, from storage or, before React runs, from the heights
 * script), else as tall as its rows.
 */
function GroupFrame({ group, action, hideVar, children }: FrameProps) {
	const shape: GroupShape = GROUP_SKELETONS[group];
	const height = useGroupHeight(group, Boolean(shape.fixed));
	const server = height === null;
	const head = action ?? shape.action;

	const style = {
		'--settings-height': server ? `var(${heightVar(group)}, auto)` : height === undefined ? undefined : `${height}px`,
		...(server && hideVar ? { display: `var(${hideVar}, flex)` } : {})
	} as CSSProperties;

	return (
		<SettingsGroup
			title={shape.title}
			group={group}
			busy
			style={style}
			action={head && shape.actionWhile ? <ActionWhile list={shape.actionWhile}>{head}</ActionWhile> : head}
		>
			{children}
		</SettingsGroup>
	);
}

/** A remembered list's group: as many rows as the list had at its last load, with the commands under them. */
function CountedGroup({ group, list, action }: { group: GroupKey; list: CountKey; action?: ReactNode }) {
	const { empty, commands, ...shape }: GroupShape = GROUP_SKELETONS[group];
	const count = useRowCount(list);

	if (count === 0 && empty === 'hide') return null;

	return (
		<GroupFrame group={group} action={action} hideVar={empty === 'hide' ? countVars(list).ifRows : undefined}>
			<CountedRows
				list={list}
				count={count}
				empty={empty}
				height={shape.height}
				glyph={shape.glyph}
				lines={shape.lines}
				copy={shape.copy}
			/>
			{commands ? <Commands list={commands} /> : null}
		</GroupFrame>
	);
}

/**
 * A group still loading: its title, its head button, and a card of
 * placeholder rows as tall as the group was when it last loaded at this
 * window width or near it, else as many rows as its list had then, or its
 * first-visit guess (`last-counts.ts`). The bars stay invisible for the
 * kit's skeleton delay, so a fast load never shows them.
 */
function SkeletonGroup({ group, action }: { group: GroupKey; action?: ReactNode }) {
	const shape: GroupShape = GROUP_SKELETONS[group];

	if (typeof shape.rows === 'string') return <CountedGroup group={group} list={shape.rows} action={action} />;

	return (
		<GroupFrame group={group} action={action}>
			<div className="settings-skeleton-part">
				<Rows count={shape.rows} height={shape.height} glyph={shape.glyph} lines={shape.lines} copy={shape.copy} />
			</div>
		</GroupFrame>
	);
}

/** The lists a section's skeleton reads, each once. */
function sectionLists(groups: readonly GroupKey[]): CountKey[] {
	const lists = groups.flatMap((group): (CountKey | undefined)[] => {
		const shape: GroupShape = GROUP_SKELETONS[group];

		return [typeof shape.rows === 'string' ? shape.rows : undefined, shape.commands, shape.actionWhile];
	});

	return [...new Set(lists.filter((list) => list !== undefined))];
}

/** Each group with whether only a height kept at this very width counts for it ({@link GroupShape.fixed}). */
function heightGroups(groups: readonly GroupKey[]): (readonly [GroupKey, boolean])[] {
	return groups.map((group) => {
		const shape: GroupShape = GROUP_SKELETONS[group];

		return [group, Boolean(shape.fixed)];
	});
}

/**
 * A whole section before its data has loaded, for the boot frame, the shell's
 * skeleton for a page still arriving, and the section itself while it loads:
 * every group's title, head button and rows, so the page lands on the same
 * lines. In the server's HTML a script ahead of it copies what was kept
 * (`last-counts.ts`) onto `<html>` before first paint. With no live buttons
 * it is inert: nothing in it works until the page replaces it. With them, a
 * button that has focus as the page replaces it hands focus to the loaded
 * group's own (`useFocusHandOff`).
 */
export function SettingsSectionSkeleton({ section, actions }: { section: SettingsSection; actions?: GroupActions }) {
	const groups = SECTION_GROUPS[section];
	const server = useBeforeStorage();
	const stack = useRef<HTMLDivElement>(null);

	useFocusHandOff(stack);

	return (
		<>
			{server ? (
				<script
					dangerouslySetInnerHTML={{
						__html: sectionLists(groups).map(countScript).join('') + heightScript(heightGroups(groups))
					}}
				/>
			) : null}
			<div ref={stack} className="settings-stack" inert={!actions}>
				{groups.map((group) => (
					<SkeletonGroup key={group} group={group} action={actions?.[group]} />
				))}
			</div>
		</>
	);
}
