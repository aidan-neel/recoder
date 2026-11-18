'use client';

import { formatContextWindow } from '@recoder/shared';
import {
	AgentMark,
	Button,
	Checkbox,
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	Input,
	ScrollArea,
	SkeletonBox
} from '@recoder/ui';
import { ChevronDown, Search } from 'lucide-react';
import { useId } from 'react';

import { shownCount, type ChooserGroup } from '@/lib/settings/model-chooser';
import type { ModelOption } from '@/lib/settings/model-options';
import { useModelChooser, type ModelChooserView } from '@/lib/settings/use-model-chooser';

import { SaveStatus } from './save-status';
import { SettingsGroup, SettingsRow } from './settings-group';

interface ModelSwitchProps {
	option: ModelOption;
	shown: boolean;
	onChange: (shown: boolean) => void;
}

/** One model: the box that puts it in the pickers, its name (which the box answers to) and its context window. */
function ModelSwitch({ option, shown, onChange }: ModelSwitchProps) {
	const boxId = useId();

	return (
		<li className="chooser-row" data-off={!shown || undefined}>
			<Checkbox id={boxId} checked={shown} onCheckedChange={onChange} />
			<label htmlFor={boxId} className="chooser-name">
				{option.name}
			</label>
			{option.contextWindow ? (
				<span className="chooser-detail">{formatContextWindow(option.contextWindow)}</span>
			) : null}
		</li>
	);
}

/** The provider's box: ticked with every model shown, clear with none, a dash with some. */
function groupState(shown: number, total: number): boolean | 'some' {
	if (shown === 0) return false;

	return shown === total ? true : 'some';
}

interface ProviderBlockProps {
	group: ChooserGroup;
	chooser: ModelChooserView;
}

/**
 * A provider: one box that shows or hides all its models at once (a dash when
 * only some show, and a press then shows them all), then a heading line that
 * opens and shuts its models and says how many show. The box works while the
 * list is shut.
 */
function ProviderBlock({ group, chooser }: ProviderBlockProps) {
	const shown = shownCount(group.options, chooser.hidden);

	return (
		<Collapsible
			className="chooser-provider"
			role="group"
			aria-label={group.heading}
			open={chooser.isOpen(group)}
			onOpenChange={(open) => chooser.setOpen(group, open)}
		>
			<div className="chooser-heading">
				<Checkbox
					checked={groupState(shown, group.options.length)}
					onCheckedChange={(on) => chooser.setGroupShown(group, on)}
					aria-label={`Show every ${group.heading} model in pickers`}
				/>
				<h3 className="chooser-provider-title">
					<CollapsibleTrigger className="chooser-trigger">
						{group.agent ? <AgentMark agent={group.agent} /> : null}
						<span className="chooser-title">{group.heading}</span>
						<span className="chooser-count">
							{shown} of {group.options.length}
						</span>
						<ChevronDown aria-hidden />
					</CollapsibleTrigger>
				</h3>
			</div>
			<CollapsibleContent>
				<ul className="chooser-rows">
					{group.options.map((option) => (
						<ModelSwitch
							key={option.id}
							option={option}
							shown={!chooser.hidden.has(option.id)}
							onChange={(on) => chooser.setShown(option.id, on)}
						/>
					))}
				</ul>
			</CollapsibleContent>
		</Collapsible>
	);
}

/** The list under the search: every provider that has a match, or a line saying none does. */
function ChooserList({ chooser }: { chooser: ModelChooserView }) {
	if (chooser.groups.length === 0) {
		return <p className="chooser-empty">No models match “{chooser.query.trim()}”.</p>;
	}

	return (
		<ScrollArea className="chooser-scroll">
			{chooser.groups.map((group) => (
				<ProviderBlock key={group.heading} group={group} chooser={chooser} />
			))}
		</ScrollArea>
	);
}

/**
 * Settings → Models, the chooser: every model of a switched-on provider with
 * a checkbox, grouped by provider and narrowed by the search. A model that is
 * off leaves every picker; a pick saved before stays where it is.
 */
export function ModelChooser() {
	const chooser = useModelChooser();

	if (chooser.view === 'loading') {
		return (
			<SettingsGroup title="Available models">
				<SkeletonBox className="chooser-loading" />
			</SettingsGroup>
		);
	}

	if (chooser.view === 'failed') {
		return (
			<SettingsGroup title="Available models">
				<SettingsRow name="Models" error={chooser.error}>
					<Button onClick={chooser.retry}>Try again</Button>
				</SettingsRow>
			</SettingsGroup>
		);
	}

	return (
		<SettingsGroup title="Available models" action={<SaveStatus state={chooser.state} />}>
			<div className="chooser-search">
				<Input
					leading={<Search aria-hidden />}
					placeholder="Search models"
					aria-label="Search models"
					value={chooser.query}
					onChange={(event) => chooser.setQuery(event.target.value)}
				/>
			</div>
			<ChooserList chooser={chooser} />
		</SettingsGroup>
	);
}
