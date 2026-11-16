import { ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import type { BugsView } from '@/lib/bugs/types';
import { plural } from '@/lib/shell/format';

type Checked = BugsView['checked'];

/** One figure of what the review covered: the number, then what it counts. */
function Figure({ value, label }: { value: ReactNode; label: string }) {
	return (
		<div className="clean-figure">
			<dt>{label}</dt>
			<dd>{value}</dd>
		</div>
	);
}

/** The sentence under the title: the claims it tested, else the leads it ruled out, else a plain all-clear. */
function cleanDetail({ claims, ruledOut }: Checked): string {
	if (claims > 0)
		return `Recoder tested ${plural(claims, 'claim')} about how this change behaves. None of them held up.`;
	if (ruledOut) return `Recoder followed ${plural(ruledOut, 'lead')} through this change and ruled each one out.`;

	return 'Nothing Recoder looked at needs your attention.';
}

/** The figures the review recorded; a review that recorded none shows no row. */
function CleanFigures({ checked }: { checked: Checked }) {
	const { units, claims, ruledOut } = checked;

	if (!units && claims === 0 && !ruledOut) return null;

	return (
		<dl className="clean-figures">
			{units ? (
				<Figure
					label="changes read"
					value={
						<>
							{units.read}
							<span className="clean-figure-of">/{units.total}</span>
						</>
					}
				/>
			) : null}
			{claims > 0 ? <Figure label="claims checked" value={claims} /> : null}
			{ruledOut ? <Figure label="leads ruled out" value={ruledOut} /> : null}
		</dl>
	);
}

/**
 * What the Bugs tab says when a finished review has no open bugs: the
 * verdict, the reason to trust it, and the figures behind it. Posting and
 * reviewing again stay in the tab row above it.
 */
export function CleanNotice({ checked }: { checked: Checked }) {
	return (
		<section className="clean-notice" role="status" aria-labelledby="clean-notice-title">
			<span className="clean-glyph" aria-hidden>
				<ShieldCheck strokeWidth={1.75} />
			</span>
			<div className="clean-copy">
				<h2 id="clean-notice-title">No bugs in this change</h2>
				<p>{cleanDetail(checked)}</p>
			</div>
			<CleanFigures checked={checked} />
		</section>
	);
}
