import { JSON_MODE_INSTRUCTION } from '../models/llm/request-fields';
import type { ChatMessage, ChatOptions } from '../models/llm/types';

/** The CLI takes one prompt, so a conversation's turns are written out as one labeled transcript. */
export function promptText(turns: ChatMessage[]): string {
	if (turns.length === 1) return turns[0].content;

	return turns.map((turn) => `${turn.role === 'assistant' ? 'Assistant' : 'User'}:\n${turn.content}`).join('\n\n');
}

/**
 * Tools are off, but a model that was trained with them can still write a tool call as its reply. This line keeps
 * the reply to plain text.
 */
const NO_TOOLS_INSTRUCTION = 'You have no tools. Never write a tool call. Reply with plain text only.';

/**
 * The system prompt a CLI is given in place of its own. JSON is asked for in words: the CLI's `--json-schema` runs as a
 * tool call, which this tool-less, one-turn call cannot make.
 */
export function systemText({ messages, jsonMode, jsonSchema }: ChatOptions): string {
	const system = messages.filter((m) => m.role === 'system').map((m) => m.content);

	system.push(NO_TOOLS_INSTRUCTION);

	if (jsonMode || jsonSchema) system.push(JSON_MODE_INSTRUCTION);

	return system.join('\n\n');
}
