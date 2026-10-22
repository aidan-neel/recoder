/** The longest message the server takes in a review conversation, and the longest earlier turn of a discussion. */
export const MAX_CHAT_MESSAGE_CHARS = 8000;

/** The longest question the server takes about one finding or receipt. */
export const MAX_QUESTION_CHARS = 4000;

/** The longest finding message the server takes with a question or a fix request. */
export const MAX_FINDING_MESSAGE_CHARS = 4000;

export interface DiscussMessage {
	role: 'user' | 'assistant';
	body: string;
}

export interface DiscussFinding {
	file: string;
	line: number;
	endLine: number;
	severity: string;
	message: string;
	agent: string;
}

export interface DiscussRequest {
	/** Reviewer role to answer as (falls back to a default when unknown). */
	agent: string;
	finding: DiscussFinding;
	history: DiscussMessage[];
	question: string;
}

export interface DiscussResponse {
	agent: string;
	model: string;
	reply: string;
}
