import { Page } from '@/components/common/page';

/**
 * What a click on an app link swaps to while the page's own code arrives: the
 * page's bar alone, the same frame a page holds while it checks its data, so
 * the old page never stays frozen under the pointer. Routes with a stable
 * shape carry their own skeleton in a `loading.tsx` beside them.
 */
export default function Loading() {
	return <Page>{null}</Page>;
}
