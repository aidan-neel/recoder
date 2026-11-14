/** How many of a job's last lines the output shows. */
const OUTPUT_LINES = 200;

/** The last lines of a job's output, so a long install stays light to draw. */
export function tailLines(output: string, count = OUTPUT_LINES): string {
	return output.split('\n').slice(-count).join('\n').trimEnd();
}
