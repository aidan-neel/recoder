import type { RawDiagnostic } from './parse-diagnostics.js';

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);

/** `eslint -f json`: one entry per file, each with its messages. Severity 2 is an error. */
function eslintJson(value: unknown): RawDiagnostic[] | null {
	if (!Array.isArray(value) || !value.every((entry) => isObject(entry) && 'filePath' in entry)) return null;

	return value.flatMap((entry: Json) =>
		(Array.isArray(entry.messages) ? entry.messages : []).flatMap((message: Json) => {
			const path = text(entry.filePath);
			const line = typeof message.line === 'number' ? message.line : 0;

			if (!path || !line || !text(message.message)) return [];

			return [
				{
					path,
					line,
					message: text(message.message)!,
					rule: text(message.ruleId),
					source: 'lint',
					tool: 'eslint',
					severity: message.severity === 2 ? 'error' : 'warning',
					raw: `${path}:${line} ${text(message.ruleId) ?? ''} ${text(message.message)}`.trim()
				} satisfies RawDiagnostic
			];
		})
	);
}

/** An oxlint code such as `eslint(curly)` or `typescript-eslint(no-explicit-any)` as one rule id. */
function oxlintRule(code: string | undefined): string | undefined {
	const match = code && /^([\w@-]+)\(([^()]+)\)$/.exec(code);

	if (!match) return code;

	const [, plugin, rule] = match;

	if (plugin === 'eslint') return rule;

	return `${plugin === 'typescript-eslint' ? '@typescript-eslint' : plugin}/${rule}`;
}

/** `oxlint --format json`: a `diagnostics` array with a filename, a code and labelled spans. */
function oxlintJson(value: unknown): RawDiagnostic[] | null {
	if (!isObject(value) || !Array.isArray(value.diagnostics)) return null;

	return value.diagnostics.flatMap((entry: Json) => {
		const label = Array.isArray(entry.labels) && isObject(entry.labels[0]) ? entry.labels[0] : null;
		const span = label && isObject(label.span) ? label.span : null;
		const line = span && typeof span.line === 'number' ? span.line : 0;
		const path = text(entry.filename);

		if (!path || !line || !text(entry.message)) return [];

		return [
			{
				path,
				line,
				message: text(entry.message)!,
				rule: oxlintRule(text(entry.code)),
				source: 'lint',
				tool: 'oxlint',
				severity: entry.severity === 'error' ? 'error' : 'warning',
				raw: `${path}:${line} ${text(entry.code) ?? ''} ${text(entry.message)}`.trim()
			} satisfies RawDiagnostic
		];
	});
}

/** One SARIF result as a diagnostic; null when it names no file and line. */
function sarifResult(result: Json, tool: string): RawDiagnostic | null {
	const location = Array.isArray(result.locations) ? result.locations[0] : null;
	const physical = isObject(location) && isObject(location.physicalLocation) ? location.physicalLocation : null;
	const artifact = physical && isObject(physical.artifactLocation) ? physical.artifactLocation : null;
	const region = physical && isObject(physical.region) ? physical.region : null;
	const path = text(artifact?.uri)?.replace(/^file:\/\//, '');
	const line = typeof region?.startLine === 'number' ? region.startLine : 0;
	const message = isObject(result.message) ? text(result.message.text) : undefined;

	if (!path || !line || !message) return null;

	return {
		path,
		line,
		message,
		rule: text(result.ruleId),
		source: 'lint',
		tool,
		severity: result.level === 'error' ? 'error' : 'warning',
		raw: `${path}:${line} ${text(result.ruleId) ?? ''} ${message}`.trim()
	};
}

/** SARIF 2.1: results under each run, named for the run's tool driver (Semgrep, ESLint's formatter, CodeQL). */
function sarif(value: unknown): RawDiagnostic[] | null {
	if (!isObject(value) || !Array.isArray(value.runs)) return null;

	return value.runs.flatMap((run: Json) => {
		const driver = isObject(run.tool) && isObject(run.tool.driver) ? text(run.tool.driver.name) : undefined;

		return (Array.isArray(run.results) ? run.results : []).flatMap((result: Json) => {
			const found = sarifResult(result, driver?.toLowerCase() ?? 'sarif');

			return found ? [found] : [];
		});
	});
}

/** Every place the output could start a JSON document: its start, or a line that opens an array or object. */
function jsonStarts(output: string): number[] {
	const starts = [0];

	for (const match of output.matchAll(/\n(?=[[{])/g)) starts.push(match.index + 1);

	return starts;
}

/**
 * The diagnostics of a tool's machine-readable output (`eslint -f json`,
 * `oxlint --format json`, SARIF), or null when the output is in none of
 * them. A script banner before the JSON is skipped. Null sends the output to
 * the line parsers.
 */
export function parseMachineDiagnostics(output: string): RawDiagnostic[] | null {
	for (const start of jsonStarts(output)) {
		let value: unknown;

		try {
			value = JSON.parse(output.slice(start).trim());
		} catch {
			continue;
		}

		const found = eslintJson(value) ?? oxlintJson(value) ?? sarif(value);

		if (found) return found;
	}

	return null;
}
