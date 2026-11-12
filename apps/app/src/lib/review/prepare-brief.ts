/**
 * The Markdown parser's way in for a review read (`review-read.ts`), which
 * imports this module on demand: the parser comes with it, so a page that
 * only reads reviews ahead, such as the queue, never loads it up front.
 */
export { prepareMarkdown } from '@recoder/ui';
