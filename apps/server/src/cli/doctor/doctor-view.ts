import { tildePath } from '../terminal/home-path.js';
import { textWidth, type Surface } from '../terminal/surface.js';
import { indent, plural, wrapText } from '../terminal/text.js';
import type { DoctorCheck, DoctorReport } from './doctor.js';

const MARGIN = 2;

/** An absolute path inside a check's sentence, up to the space or the full stop that ends it. */
const ABSOLUTE_PATH = /\/[^\s]*[^\s.]/g;

/** `recoder doctor`: a line per check saying what was found, the fix under each that failed, and the verdict. */
export function doctorView(report: DoctorReport, surface: Surface): string[] {
	const checks = report.checks.flatMap((check) => checkLines(check, surface));

	return ['', ...indent([...checks, '', verdict(report, surface)], MARGIN), ''];
}

/** One check: its mark, what was found with home paths shortened, and the fix of one that failed. */
function checkLines(check: DoctorCheck, surface: Surface): string[] {
	const { paint, glyphs } = surface;
	const textIndent = glyphs.ok.length + 1;
	const room = textWidth(surface, MARGIN + textIndent);

	const [first = '', ...rest] = wrapText(
		check.detail.replace(ABSOLUTE_PATH, (path) => tildePath(path)),
		room
	);

	const fix = check.fix === null ? [] : wrapText(`${glyphs.arrow} ${check.fix}`, room).map(paint.muted);

	return [`${markOf(check, surface)} ${first}`, ...indent([...rest, ...fix], textIndent)];
}

/** A passed check, a failed one that stops reviews, or a failed optional one that only limits them. */
function markOf(check: DoctorCheck, { paint, glyphs }: Surface): string {
	if (check.ok) return paint.ok(glyphs.ok);

	return check.required ? paint.error(glyphs.fail) : paint.warning(glyphs.warn);
}

function verdict(report: DoctorReport, { paint }: Surface): string {
	const failed = report.checks.filter((check) => !check.ok && check.required).length;

	if (!report.ok) {
		return paint.strong(paint.error(`Not ready: ${plural(failed, 'problem')} to fix before a review can run.`));
	}

	const isLimited = report.checks.some((check) => !check.ok);

	return paint.strong(isLimited ? 'Ready to review, without running code.' : 'Ready to review.');
}
