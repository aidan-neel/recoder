import { redirect } from 'next/navigation';

/** Settings was a page; it is a modal now, and the old address opens it over the queue. */
export default function Page() {
	redirect('/?settings=agent');
}
