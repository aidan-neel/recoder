import type { LogLine } from '@recoder/shared';

import { logTime } from '@/lib/server/log-lines';

/** Log lines, one a row: the time, the level, where it came from and what it said, in the code face. */
export function LogLines({ lines, label }: { lines: readonly LogLine[]; label: string }) {
	return (
		<ol className="server-log" aria-label={label}>
			{lines.map((line) => (
				<li key={line.seq} className="server-log-line" data-level={line.level}>
					<time dateTime={line.at}>{logTime(line)}</time>
					<span className="server-log-level">{line.level}</span>
					<span className="server-log-source">{line.source}</span>
					<span className="server-log-message">{line.message}</span>
				</li>
			))}
		</ol>
	);
}
