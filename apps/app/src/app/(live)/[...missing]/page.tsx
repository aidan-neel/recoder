import { notFound } from 'next/navigation';

/** Every address no other route answers, so the missing page shows beside the sidebar. */
export default function MissingPage() {
	notFound();
}
