import type { LogLine } from '@recoder/shared';

/** Formats every log line's time, made once: a formatter per line costs a few ms across a page. */
let timeFormat: Intl.DateTimeFormat | undefined;

/** A log line's time to the second, `16:20:04`, in the reader's time zone. */
export function logTime(line: LogLine): string {
	timeFormat ??= new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

	return timeFormat.format(Date.parse(line.at));
}
