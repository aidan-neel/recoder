'use client';

import { HoverList, RowButton, StatusGlyph, Switch } from '@recoder/ui';
import { Plus } from 'lucide-react';

import { entryGlyph, entryStatus, type ProviderEntry } from '@/lib/settings/providers/provider-entries';
import type { ProviderSwitches } from '@/lib/settings/providers/use-provider-switches';

import { ProviderMark } from './provider-mark';

interface ProviderRailProps {
	entries: readonly ProviderEntry[];
	selectedKey: string | null;
	onSelect: (key: string) => void;
	switches: ProviderSwitches;
	onAdd: () => void;
}

/**
 * The left of Settings → Providers: each agent CLI as a row with its logo,
 * name, version and status, and a switch at its end. The row picks what the
 * detail panel shows; the switch takes the CLI out of the pickers and
 * reviews. Add provider closes the list.
 */
export function ProviderRail({ entries, selectedKey, onSelect, switches, onAdd }: ProviderRailProps) {
	return (
		<HoverList as="ul" className="provider-rail" itemSelector="[data-rail-row]" selectedSelector="[data-selected]">
			{entries.map((entry) => (
				<RailRow
					key={entry.key}
					entry={entry}
					selected={entry.key === selectedKey}
					on={switches.isOn(entry.key)}
					onSelect={() => onSelect(entry.key)}
					onTurn={(on) => switches.turn(entry.key, on)}
				/>
			))}
			<li className="provider-rail-row" data-rail-row>
				<RowButton cover className="provider-rail-add" onClick={onAdd}>
					<Plus aria-hidden />
					Add provider
				</RowButton>
			</li>
		</HoverList>
	);
}

interface RailRowProps {
	entry: ProviderEntry;
	selected: boolean;
	on: boolean;
	onSelect: () => void;
	onTurn: (on: boolean) => void;
}

/** One CLI: the row picks it; the switch sits above the row's cover so it stays its own control. */
function RailRow({ entry, selected, on, onSelect, onTurn }: RailRowProps) {
	const { agent } = entry;

	return (
		<li className="provider-rail-row" data-rail-row data-selected={selected || undefined} data-off={!on || undefined}>
			<ProviderMark agent={agent.id} />
			<div className="provider-rail-text">
				<RowButton cover className="provider-rail-name" aria-current={selected || undefined} onClick={onSelect}>
					<span className="provider-rail-name-text">{agent.name}</span>
					{agent.version ? <span className="provider-version">{agent.version}</span> : null}
				</RowButton>
				<span className="provider-rail-status">
					<StatusGlyph kind={entryGlyph(agent)} />
					<span className="provider-rail-status-text">{entryStatus(agent)}</span>
				</span>
			</div>
			<Switch className="provider-rail-switch" checked={on} onCheckedChange={onTurn} aria-label={`Use ${agent.name}`} />
		</li>
	);
}
