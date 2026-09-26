import type { ReviewChatMessage, ReviewToolCall } from '@recoder/shared';

export type TranscriptItem =
	| { kind: 'message'; id: string; at: string; message: ReviewChatMessage }
	| { kind: 'tasks'; id: string; at: string; tools: ReviewToolCall[] };

/** Failed retrievals in older snapshots can lack both command and input.action. */
export function toolPresentation(tool: Pick<ReviewToolCall, 'command' | 'input'>) {
	const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
	const command = text(tool.command);
	const action = text(tool.input?.action) || command.split(/\s+/)[0];
	const target = text(tool.input?.command) || text(tool.input?.path) || text(tool.input?.query) || text(tool.input?.prefix) || command.replace(/^\S+\s*/, '');
	return { action, target, name: command || [action || 'Tool request', target].filter(Boolean).join(' ') };
}

/** A message separates work groups; streaming updates retain the first tool's key. */
export function groupTranscript(messages: ReviewChatMessage[], tools: ReviewToolCall[]): TranscriptItem[] {
	const timeline = [
		...messages.filter((message) => (message.text.trim() || message.failure) && message.id !== 'review-result')
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

/** Glyph and failure count for a tool group; a tool still "running" after the review stopped failed. */
export function taskGroupStatus(tools: ReviewToolCall[], active: boolean): { status: 'running' | 'error' | 'done'; failed: number } {
	const failed = tools.filter((tool) => tool.status === 'error' || (!active && tool.status === 'running')).length;
	const running = active && tools.some((tool) => tool.status === 'running');
	return { status: running ? 'running' : failed ? 'error' : 'done', failed };
}

/**
 * The group header, written as a sentence. While live it names only what is
 * still going ("Reading 2 files"); once done it sums the group ("Read 3 files,
 * searched once").
 */
export function taskGroupLabel(tools: ReviewToolCall[], live = false): string {
	let runs = 0, writes = 0, reads = 0, searches = 0, listings = 0, other = 0;
	const running = tools.filter((tool) => tool.status === 'running');
	for (const tool of live && running.length ? running : tools) {
		const { action } = toolPresentation(tool);
		if (action === 'run' || action === '$') runs++;
		else if (action === 'writeFile') writes++;
		else if (['read', 'readFile', 'readDiff'].includes(action)) reads++;
		else if (['search', 'rg'].includes(action)) searches++;
		else if (['list', 'listFiles'].includes(action)) listings++;
		else other++;
	}
	const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
	const times = (n: number) => n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`;
	const parts = live
		? [
				runs ? `running ${count(runs, 'command', 'commands')}` : '',
				writes ? `writing ${count(writes, 'file', 'files')}` : '',
				reads ? `reading ${count(reads, 'file', 'files')}` : '',
				searches ? (searches === 1 ? 'searching' : `running ${searches} searches`) : '',
				listings ? 'listing files' : '',
				other ? `running ${count(other, 'tool', 'tools')}` : ''
			]
		: [
				runs ? `ran ${count(runs, 'command', 'commands')}` : '',
				writes ? `wrote ${count(writes, 'file', 'files')}` : '',
				reads ? `read ${count(reads, 'file', 'files')}` : '',
				searches ? `searched ${times(searches)}` : '',
				listings ? `listed files ${times(listings)}` : '',
				other ? `ran ${count(other, 'tool', 'tools')}` : ''
			];
	const sentence = parts.filter(Boolean).join(', ');
	return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
