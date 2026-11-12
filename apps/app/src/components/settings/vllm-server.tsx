'use client';

import { formatContextWindow, type VllmModel, type VllmServer } from '@recoder/shared';
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Pill, StatusGlyph } from '@recoder/ui';
import { ChevronDown } from 'lucide-react';

import { useVllmModels } from '@/lib/settings/use-vllm-models';
import { syncLine } from '@/lib/settings/vllm-text';

import { SettingsRow } from './settings-group';

/** What a model's line ends with: its context window, or that the server stopped serving it. */
function ModelFact({ model }: { model: VllmModel }) {
	if (!model.served) return <Pill tone="medium">Not served</Pill>;
	if (!model.contextWindow) return null;

	return <span className="server-model-window">{formatContextWindow(model.contextWindow)} context</span>;
}

/** One captured model: the id the server serves it under, then its context window. */
function ModelLine({ model }: { model: VllmModel }) {
	return (
		<li className="server-model">
			<span className="server-model-id mono" title={model.id}>
				{model.id}
			</span>
			<ModelFact model={model} />
		</li>
	);
}

/** The server's models: the first few always on show, the rest behind a disclosure. */
function ServedModels({ models }: { models: VllmModel[] }) {
	const view = useVllmModels(models);

	if (models.length === 0) return null;

	return (
		<Collapsible open={view.open} onOpenChange={view.setOpen} className="server-models">
			<ul className="server-model-list" aria-label="Models">
				{view.head.map((model) => (
					<ModelLine key={model.id} model={model} />
				))}
			</ul>
			{view.moreLabel ? (
				<>
					<CollapsibleContent>
						<ul className="server-model-list" aria-label="More models">
							{view.rest.map((model) => (
								<ModelLine key={model.id} model={model} />
							))}
						</ul>
					</CollapsibleContent>
					<CollapsibleTrigger asChild>
						<Button variant="ghost" className="server-more">
							<ChevronDown aria-hidden />
							{view.moreLabel}
						</Button>
					</CollapsibleTrigger>
				</>
			) : null}
		</Collapsible>
	);
}

interface VllmServerItemProps {
	server: VllmServer;
	/** The time now, which moves on so "Synced 2 minutes ago" keeps up. */
	now: number;
	onRemove: (server: VllmServer) => void;
}

/** One connected server: whether its list is in sync, how fresh it is, Disconnect, and the models it serves. */
export function VllmServerItem({ server, now, onRemove }: VllmServerItemProps) {
	const line = syncLine(server, now);

	return (
		<div className="status-item">
			<SettingsRow
				name={
					<span className="status-name">
						<StatusGlyph kind={server.error ? 'failed' : 'ok'} label={server.error ? 'Out of sync' : 'In sync'} />
						<span className="status-name-text mono" title={server.host}>
							{server.host}
						</span>
					</span>
				}
				detail={server.error ? <span className="row-problem">{line}</span> : line}
			>
				<Button variant="ghost" aria-label={`Disconnect ${server.host}`} onClick={() => onRemove(server)}>
					Disconnect
				</Button>
			</SettingsRow>
			<ServedModels models={server.models} />
		</div>
	);
}
