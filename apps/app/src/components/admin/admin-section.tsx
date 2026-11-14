'use client';

import { MembersSection } from './members-section';
import { UpdateStrip } from './update-strip';

/** Settings → Admin: the running Recoder and its updates, who has signed in, and their models. */
export function AdminSection() {
	return (
		<div className="settings">
			<UpdateStrip />
			<MembersSection />
		</div>
	);
}
