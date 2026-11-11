import { expect, test } from 'bun:test';
import type { ParseArgsOptionDescriptor } from 'node:util';
import { REVIEW_FLAGS } from '../../../src/cli/args/flags';
import { helpRowOf } from '../../../src/cli/args/flag-table';
import { listTools } from '../../../src/cli/mcp/tools';

const TOOL_REVIEW_GROUPS: readonly string[] = ['target', 'scope', 'intent', 'tuning'];

/** The review flags a tool call can use: every group of `recoder review` but output and running. */
const TOOL_REVIEW_FLAGS = Object.fromEntries(
	Object.entries(REVIEW_FLAGS).filter(([, flag]) => TOOL_REVIEW_GROUPS.includes(flag.group))
);

/** The JSON Schema type a flag of this kind becomes. */
function schemaTypeOf(option: ParseArgsOptionDescriptor): string {
	if (option.type === 'boolean') return 'boolean';

	return option.multiple === true ? 'array' : 'string';
}

function reviewInputProperties(): Record<string, { type?: unknown; description?: unknown }> {
	const review = listTools().find((tool) => tool.name === 'recoder_review');
	const schema = review?.inputSchema;

	if (typeof schema !== 'object' || schema.properties === undefined)
		throw new Error('recoder_review has no properties');

	return Object.fromEntries(
		Object.entries(schema.properties).map(([name, property]) => [name, typeof property === 'object' ? property : {}])
	);
}

test('tools/list offers the eight recoder tools', () => {
	expect(listTools().map((tool) => tool.name)).toEqual([
		'recoder_doctor',
		'recoder_models',
		'recoder_review',
		'recoder_wait',
		'recoder_status',
		'recoder_result',
		'recoder_cancel',
		'recoder_runs'
	]);
});

test('the review tool takes exactly the target, scope, intent and tuning flags of recoder review', () => {
	expect(Object.keys(reviewInputProperties()).sort()).toEqual(Object.keys(TOOL_REVIEW_FLAGS).sort());
});

test('each review property has the kind of its flag and the help row of its flag', () => {
	const properties = reviewInputProperties();

	for (const [name, option] of Object.entries(TOOL_REVIEW_FLAGS)) {
		const { type, description } = properties[name];

		expect(type).toBe(schemaTypeOf(option));
		expect(String(description)).toStartWith(`--${name}`);
	}
});

test("the diff property has the tool's own description, since the CLI help offers standard input the tool refuses", () => {
	const [, cliDescription] = helpRowOf(REVIEW_FLAGS, 'diff');

	expect(String(reviewInputProperties().diff.description)).not.toContain(cliDescription);
});
