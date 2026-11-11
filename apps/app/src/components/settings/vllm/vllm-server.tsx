'use client';

import { formatContextWindow, type VllmModel, type VllmServer } from '@recoder/shared';
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, Pill, StatusGlyph } from '@recoder/ui';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { syncLine } from '@/lib/settings/vllm-text';
import { plural } from '@/lib/shell/format';

import { SettingsRow } from '../settings-group';

/** Models listed before the rest fold behind "Show all". */
const SHOWN = 5;

/** One captured model: the id the server serves it under, and its context window (`max_model_len`). */
function ModelLine({ model }: { model: VllmModel }) {
	return (
		<li className="vllm-model">
			<span className="vllm-model-id" title={model.id}>
				{model.id}
			</span>
			{model.served ? (
				model.contextWindow ? (
					<span className="vllm-model-window">{formatContextWindow(model.contextWindow)} context</span>
				) : null
			) : (
				<Pill tone="medium">Not served</Pill>
			)}
		</li>
	);
}

/** The server's models, the first few always shown and the rest behind a disclosure. */
function ModelList({ models }: { models: VllmModel[] }) {
	const [open, setOpen] = useState(false);
	const head = models.slice(0, SHOWN);
	const rest = models.slice(SHOWN);

	return (
		<Collapsible open={open} onOpenChange={setOpen} className="vllm-models">
			<ul className="vllm-model-list" aria-label="Models">
				{head.map((model) => (
					<ModelLine key={model.id} model={model} />
				))}
			</ul>
			{rest.length ? (
				<>
					<CollapsibleContent>
						<ul className="vllm-model-list vllm-model-rest">
							{rest.map((model) => (
								<ModelLine key={model.id} model={model} />
							))}
						</ul>
					</CollapsibleContent>
					<CollapsibleTrigger asChild>
						<Button variant="ghost" className="vllm-more">
							<ChevronDown aria-hidden className="vllm-more-chevron" />
							{open ? 'Show fewer' : plural(rest.length, 'more model')}
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

/** One connected server: its state, how fresh its list is, Disconnect, and the models it serves. */
export function VllmServerItem({ server, now, onRemove }: VllmServerItemProps) {
	return (
		<div data-ui="vllm-server" className="provider-item">
			<SettingsRow
				className="provider-row"
				leading={
					<StatusGlyph
						kind={server.error ? 'failed' : 'ok'}
						label={server.error ? 'Out of sync' : 'In sync'}
						className="provider-glyph"
					/>
				}
				name={server.host}
				description={syncLine(server, now)}
			>
				<Button variant="ghost" data-vllm-control={server.id} onClick={() => onRemove(server)}>
					Disconnect
				</Button>
			</SettingsRow>
			<ModelList models={server.models} />
		</div>
	);
}
