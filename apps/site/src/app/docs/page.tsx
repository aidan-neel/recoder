import { redirect } from 'next/navigation';

import { docs } from '~/lib/docs';

/** /docs has no page of its own: it opens the first one (a 307). */
export default function Docs() {
	redirect(`/docs/${docs[0].slug}`);
}
