import { z } from 'zod';
import { loadOrNotReady } from '../exit.js';
import { modelsTool } from './models-tool.js';
import { reviewTool } from './review-tool.js';
import { cancelTool, resultTool, runsTool, statusTool, waitTool } from './run-tools.js';
import { defineTool, jsonResult, type McpTool } from './tool.js';

/** Loads the doctor, and with it the saved model settings, only when it is called. */
const doctorTool = defineTool({
	name: 'recoder_doctor',
	description:
		'Checks that a review can run on this machine and returns a JSON report: { ok, checks: [{ id, ok, required, detail, fix }] }. Run it before the first review. When ok is false, tell the user the fix of each failed required check and stop.',
	input: z.object({}).strict(),
	run: async () => {
		const { runDoctor } = await loadOrNotReady(() => import('../doctor/doctor.js'));

		return jsonResult(await runDoctor());
	}
});

const TOOLS: readonly McpTool[] = [
	doctorTool,
	modelsTool,
	reviewTool,
	waitTool,
	statusTool,
	resultTool,
	cancelTool,
	runsTool
];

/** What `tools/list` returns. */
export function listTools(): McpTool['definition'][] {
	return TOOLS.map((tool) => tool.definition);
}

export function findTool(name: string): McpTool | undefined {
	return TOOLS.find((tool) => tool.definition.name === name);
}
