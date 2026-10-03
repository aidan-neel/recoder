import { z } from 'zod';

/** The finding a developer discusses or asks a fix for, as the routes accept it. */
export const findingRequestSchema = z.object({
	file: z.string().min(1).max(500),
	line: z.number().int().positive(),
	endLine: z.number().int().positive(),
	severity: z.string().min(1).max(20),
	message: z.string().min(1).max(4000)
});

/** The first line of a prompt about one finding. */
export function describeFinding(finding: z.infer<typeof findingRequestSchema>): string {
	return `Finding (${finding.severity}, ${finding.file}:${finding.line}-${finding.endLine}): ${finding.message}`;
}
