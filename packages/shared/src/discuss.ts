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
