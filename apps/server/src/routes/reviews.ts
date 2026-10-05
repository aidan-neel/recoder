import { Hono } from 'hono';
import candidates from './reviews/candidates';
import chat from './reviews/chat';
import checks from './reviews/checks';
import dismissals from './reviews/dismissals';
import fixes from './reviews/fixes';
import lifecycle from './reviews/lifecycle';
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
app.route('/', dismissals);
app.route('/', checks);
app.route('/', candidates);

export default app;
