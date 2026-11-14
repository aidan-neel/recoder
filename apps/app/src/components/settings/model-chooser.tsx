'use client';

import { formatContextWindow } from '@recoder/shared';
import {
	AgentMark,
	Button,
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	Input,
	ScrollArea,
	Skeleton,
	Switch
} from '@recoder/ui';
import { ChevronRight, Search } from 'lucide-react';

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

/** One model: its name, its context window, and the switch that puts it in the pickers. */
function ModelSwitch({ option, shown, onChange }: ModelSwitchProps) {
	return (
		<li className="chooser-row" data-off={!shown || undefined}>
			<span className="chooser-name">{option.name}</span>
			{option.contextWindow ? (
				<span className="chooser-detail">{formatContextWindow(option.contextWindow)}</span>
			) : null}
			<Switch checked={shown} onCheckedChange={onChange} aria-label={`Show ${option.name} in pickers`} />
		</li>
	);
}

interface ProviderBlockProps {
	group: ChooserGroup;
	chooser: ModelChooserView;
}

/**
 * A provider: a heading line that opens and shuts its models and says how many
 * show, with Show all and Hide all beside it. Those two work while it is shut.
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
				<h3 className="chooser-provider-title">
					<CollapsibleTrigger className="chooser-trigger">
						<ChevronRight aria-hidden />
						{group.agent ? <AgentMark agent={group.agent} /> : null}
						<span className="chooser-title">{group.heading}</span>
						<span className="chooser-count">
							{shown} of {group.options.length}
						</span>
					</CollapsibleTrigger>
				</h3>
				<Button
					variant="quiet"
					disabled={shown === group.options.length}
					onClick={() => chooser.setGroupShown(group, true)}
				>
					Show all
				</Button>
				<Button variant="quiet" disabled={shown === 0} onClick={() => chooser.setGroupShown(group, false)}>
					Hide all
				</Button>
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
 * a switch, grouped by provider and narrowed by the search. A model that is
 * off leaves every picker; a pick saved before stays where it is.
 */
export function ModelChooser() {
	const chooser = useModelChooser();

	if (chooser.view === 'loading') {
		return (
			<SettingsGroup title="Available models">
				<Skeleton className="chooser-loading" />
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
