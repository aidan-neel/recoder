import { Hono } from 'hono';
import candidates from './reviews/candidates';
import chat from './reviews/chat';
import checks from './reviews/checks';
import decisions from './reviews/decisions';
import feedback from './reviews/feedback';
import fixes from './reviews/fixes';
import lifecycle from './reviews/lifecycle';
import pullComments from './reviews/pull-comments';
import streams from './reviews/streams';

/**
 * Review routes, one module per sub-resource. Lifecycle mounts first: its
 * `/progress-summaries` must match before the `/:id` route it sits beside.
 */
const app = new Hono();

app.route('/', lifecycle);
app.route('/', streams);
app.route('/', chat);
app.route('/', fixes);
app.route('/', decisions);
app.route('/', feedback);
app.route('/', checks);
app.route('/', candidates);
app.route('/', pullComments);

export default app;
