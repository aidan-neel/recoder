import type { ReviewChatMessage, ReviewToolCall } from '@recoder/shared';

export type TranscriptItem =
	| { kind: 'message'; id: string; at: string; message: ReviewChatMessage }
	| { kind: 'tasks'; id: string; at: string; tools: ReviewToolCall[] };

/** Failed retrievals in older snapshots can lack both command and input.action. */
export function toolPresentation(tool: Pick<ReviewToolCall, 'command' | 'input'>) {
	const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
	const command = text(tool.command);
	const action = text(tool.input?.action) || command.split(/\s+/)[0];
	const target = text(tool.input?.path) || text(tool.input?.query) || text(tool.input?.prefix) || command.replace(/^\S+\s*/, '');
	return { action, target, name: command || [action || 'Tool request', target].filter(Boolean).join(' ') };
}

/** A message separates work groups; streaming updates retain the first tool's key. */
export function groupTranscript(messages: ReviewChatMessage[], tools: ReviewToolCall[]): TranscriptItem[] {
	const timeline = [
		...messages.filter((message) => message.text.trim() && message.id !== 'review-result')
			.map((message) => ({ kind: 'message' as const, id: message.id, at: message.at, message })),
		...tools.map((tool) => ({ kind: 'tool' as const, id: tool.id, at: tool.startedAt, tool }))
	].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
	const groups: TranscriptItem[] = [];
	for (const entry of timeline) {
		if (entry.kind === 'message') { groups.push(entry); continue; }
		const previous = groups.at(-1);
		if (previous?.kind === 'tasks') previous.tools.push(entry.tool);
		else groups.push({ kind: 'tasks', id: entry.id, at: entry.at, tools: [entry.tool] });
	}
	return groups;
}

export function taskGroupLabel(tools: ReviewToolCall[]): string {
	let reads = 0, searches = 0, listings = 0, other = 0;
	for (const tool of tools) {
		const { action } = toolPresentation(tool);
		if (['read', 'readFile', 'readDiff'].includes(action)) reads++;
		else if (['search', 'rg'].includes(action)) searches++;
		else if (['list', 'listFiles'].includes(action)) listings++;
		else other++;
	}
	return [
		reads ? `${reads} file ${reads === 1 ? 'read' : 'reads'}` : '',
		searches ? `${searches} ${searches === 1 ? 'search' : 'searches'}` : '',
		listings ? `${listings} file ${listings === 1 ? 'listing' : 'listings'}` : '',
		other ? `${other} ${other === 1 ? 'operation' : 'operations'}` : ''
	].filter(Boolean).join(' · ');
}
