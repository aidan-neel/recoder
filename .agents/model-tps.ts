#!/usr/bin/env bun

/**
 * Measure streamed model generation speed against an OpenAI-compatible endpoint.
 *
 * Usage:
 *   bun .agents/model-tps.ts
 *   bun .agents/model-tps.ts --prompt-file ./prompt.txt --show-output
 *   printf 'your prompt' | bun .agents/model-tps.ts --stdin
 *
 * Configuration defaults to the review environment variables, but can be
 * overridden with --base-url, --api-key, and --model.
 */

import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

type Args = {
	baseUrl?: string;
	apiKey?: string;
	model?: string;
	promptFile?: string;
	stdin: boolean;
	showOutput: boolean;
	maxTokens: number;
	headers: string[];
};

const DEFAULT_PROMPT = Array.from(
	{ length: 750 },
	(_, index) => `Benchmark context item ${index + 1}: briefly consider this input while generating a useful response.`
).join(' ');

function usage(): never {
	console.log(`Usage: bun .agents/model-tps.ts [options]

Options:
  --prompt-file <path>  Read the prompt from a file
  --stdin               Read the prompt from standard input
  --base-url <url>      OpenAI-compatible API base URL
  --api-key <key>       API key
  --model <name>        Model name
  --max-tokens <n>      Maximum output tokens (default: 256)
  --header <name:val>   Extra request header (repeatable)
  --show-output         Print the generated response
  --help                Show this help

Environment defaults:
  RECODER_REVIEW_BASE_URL, RECODER_REVIEW_API_KEY, RECODER_REVIEW_MODEL`);
	process.exit(0);
}

function parseArgs(argv: string[]): Args {
	const args: Args = { stdin: false, showOutput: false, maxTokens: 256, headers: [] };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const value = () => {
			const next = argv[++i];
			if (!next) throw new Error(`${arg} requires a value`);
			return next;
		};
		switch (arg) {
			case '--prompt-file': args.promptFile = value(); break;
			case '--stdin': args.stdin = true; break;
			case '--base-url': args.baseUrl = value(); break;
			case '--api-key': args.apiKey = value(); break;
			case '--model': args.model = value(); break;
			case '--max-tokens': args.maxTokens = Number(value()); break;
			case '--header': args.headers.push(value()); break;
			case '--show-output': args.showOutput = true; break;
			case '--help': usage(); break;
			default: throw new Error(`Unknown option: ${arg}`);
		}
	}
	if (!Number.isInteger(args.maxTokens) || args.maxTokens < 1) {
		throw new Error('--max-tokens must be a positive integer');
	}
	if (args.promptFile && args.stdin) throw new Error('Use either --prompt-file or --stdin, not both');
	return args;
}

function promptFor(args: Args): string {
	if (args.promptFile) return readFileSync(args.promptFile, 'utf8').trim();
	if (args.stdin) return readFileSync(0, 'utf8').trim();
	return DEFAULT_PROMPT;
}

function jsonValue(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const baseUrl = (args.baseUrl ?? process.env.RECODER_REVIEW_BASE_URL ?? '').replace(/\/$/, '');
	const apiKey = args.apiKey ?? process.env.RECODER_REVIEW_API_KEY ?? '';
	const model = args.model ?? process.env.RECODER_REVIEW_MODEL ?? '';
	if (!baseUrl || !apiKey || !model) {
		throw new Error('Set RECODER_REVIEW_BASE_URL, RECODER_REVIEW_API_KEY, and RECODER_REVIEW_MODEL');
	}

	const prompt = promptFor(args);
	if (!prompt) throw new Error('Prompt is empty');
	console.log(`Model: ${model}`);
	console.log(`Prompt characters: ${prompt.length} (roughly ${Math.round(prompt.length / 4)} tokens)`);
	console.log('Generating...');

	const extraHeaders: Record<string, string> = {};
	for (const header of args.headers) {
		const colon = header.indexOf(':');
		if (colon < 0) throw new Error(`Invalid --header (expected name:value): ${header}`);
		extraHeaders[header.slice(0, colon).trim()] = header.slice(colon + 1).trim();
	}

	const response = await fetch(`${baseUrl}/chat/completions`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, ...extraHeaders },
		body: JSON.stringify({
			model,
			messages: [{ role: 'user', content: prompt }],
			temperature: 0,
			max_tokens: args.maxTokens,
			stream: true,
			stream_options: { include_usage: true }
		})
	});
	if (!response.ok || !response.body) {
		throw new Error(`LLM ${response.status}: ${(await response.text()).slice(0, 500)}`);
	}

	const started = performance.now();
	let firstTokenAt: number | undefined;
	let output = '';
	let outputTokens: number | undefined;
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let done = false;
	while (!done) {
		const chunk = await reader.read();
		buffer += decoder.decode(chunk.value, { stream: !chunk.done });
		let newline: number;
		while ((newline = buffer.indexOf('\n')) >= 0) {
			const line = buffer.slice(0, newline).trim();
			buffer = buffer.slice(newline + 1);
			if (!line.startsWith('data:')) continue;
			const data = line.slice(5).trim();
			if (data === '[DONE]') { done = true; break; }
			let event: Record<string, unknown>;
			try { event = JSON.parse(data) as Record<string, unknown>; } catch { continue; }
			const usage = jsonValue(event.usage);
			if (typeof usage?.completion_tokens === 'number') outputTokens = usage.completion_tokens;
			const choices = Array.isArray(event.choices) ? event.choices : [];
			const choice = jsonValue(choices[0]);
			const delta = jsonValue(choice?.delta);
			const text = typeof delta?.content === 'string' ? delta.content : '';
			const reasoning = typeof delta?.reasoning_content === 'string' ? delta.reasoning_content : '';
			if (text || reasoning) firstTokenAt ??= performance.now();
			if (text) output += text;
		}
		if (chunk.done) done = true;
	}

	const finished = performance.now();
	const measuredSeconds = ((finished - (firstTokenAt ?? started)) / 1000);
	const countedTokens = outputTokens ?? Math.max(1, Math.round(output.length / 4));
	const countSource = outputTokens === undefined ? 'estimated' : 'reported';
	console.log(`Output tokens: ${countedTokens} (${countSource})`);
	console.log(`Time to first token: ${firstTokenAt ? ((firstTokenAt - started) / 1000).toFixed(2) : 'n/a'}s`);
	console.log(`Generation speed: ${(countedTokens / Math.max(measuredSeconds, 0.001)).toFixed(2)} tokens/sec`);
	if (args.showOutput) console.log(`\n${output}`);
}

try {
	await main();
} catch (error) {
	console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
}
