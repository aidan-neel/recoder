import { z } from 'zod';
import { decodeSecretKey } from './secrets/key-format';

/**
 * The review shapes an experiment compares with the baseline (issue #95): `specialist-tree` has a coordinator
 * assign the reviewers' slices to domain specialists, `independent-pass` adds a second review of every slice
 * that never sees the first pass's findings, and `lens-split` gives every slice one reviewer per lens group in
 * place of one reviewer of every lens, cut without a model call.
 */
const REVIEW_VARIANTS = ['specialist-tree', 'independent-pass', 'lens-split'] as const;

type ReviewVariant = (typeof REVIEW_VARIANTS)[number];

const reviewVariantSchema = z.preprocess(
	(value) => (value === '' ? undefined : value),
	z.enum(REVIEW_VARIANTS).optional()
);

/**
 * The tools a review's reviewers and subagents get (`RECODER_REVIEWER_TOOLS`). `none`, the default, gives
 * reviewers no tool at all: each answers in one call from the patch of its slice and the context the harness
 * gathered, and the review sends no subagent, since a subagent exists to follow a question with tools. A review
 * then rests on what the harness hands the model, not on how well the model drives an agent loop. `read` gives
 * them the reads and searches: no shell, no scratch files and no workers. `all` gives them every tool.
 */
const REVIEWER_TOOLS = ['none', 'read', 'all'] as const;

type ReviewerTools = (typeof REVIEWER_TOOLS)[number];

const reviewerToolsSchema = z.preprocess(
	(value) => (value === '' ? undefined : value),
	z.enum(REVIEWER_TOOLS).optional()
);

/** An OAuth application's client id: public, so only its shape is checked. Blank means the forge is not set up. */
const oauthClientIdSchema = z.preprocess(
	(value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
	z
		.string()
		.trim()
		.regex(/^[A-Za-z0-9._-]{1,200}$/, 'An OAuth client id holds letters, digits, dots, dashes and underscores.')
		.optional()
);

/** An OAuth application's client secret: private, so never echoed. Blank means the forge has none. */
const oauthClientSecretSchema = z.preprocess(
	(value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
	z.string().trim().min(1).max(500).optional()
);

/** The address people reach this server at, when a proxy hides it from the request (`https://recoder.example.ts.net`). */
const publicUrlSchema = z.preprocess(
	(value) => (value === '' ? undefined : value),
	z
		.url()
		.refine((value) => /^https?:\/\//.test(value), { message: 'RECODER_PUBLIC_URL must be an http(s) URL.' })
		.optional()
);

/** A fixed access token for API clients on a server whose replicas share no data dir. */
const apiTokenSchema = z.preprocess(
	(value) => (value === '' ? undefined : value),
	z.string().min(32).max(200).optional()
);

const envSchema = z.object({
	PORT: z.coerce.number().int().positive().default(3001),
	HOST: z.string().default('0.0.0.0'),
	FRONTEND_URL: z.string().default('http://localhost:3000'),
	GITHUB_WEBHOOK_SECRET: z.string().optional(),
	GITLAB_WEBHOOK_SECRET: z.string().optional(),
	RECODER_DATABASE_URL: z.preprocess(
		(value) => (value === '' ? undefined : value),
		z
			.url()
			.refine((value) => /^postgres(ql)?:\/\//.test(value), {
				message: 'RECODER_DATABASE_URL must be a postgres:// or postgresql:// URL.'
			})
			.optional()
	),
	RECODER_JOB_LEASE_MS: z.coerce.number().int().min(1000).max(300_000).default(30_000),
	RECODER_JOB_POLL_MS: z.coerce.number().int().min(50).max(5000).default(250),
	RECODER_JOB_CONCURRENCY: z.coerce.number().int().min(0).max(32).default(2),
	RECODER_INSTANCE_ID: z.string().min(1).max(200).optional(),
	RECODER_WORKDIR: z.string().default('/tmp/recoder-work'),
	RECODER_ALLOWED_COMMANDS: z.string().default('echo,git,gh,glab,bun'),
	RECODER_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
	RECODER_REVIEW_VARIANT: reviewVariantSchema,
	RECODER_REVIEWER_TOOLS: reviewerToolsSchema,
	RECODER_GITHUB_CLIENT_ID: oauthClientIdSchema,
	RECODER_GITLAB_CLIENT_ID: oauthClientIdSchema,
	RECODER_GITHUB_CLIENT_SECRET: oauthClientSecretSchema,
	RECODER_GITLAB_CLIENT_SECRET: oauthClientSecretSchema,
	RECODER_PUBLIC_URL: publicUrlSchema,
	RECODER_API_TOKEN: apiTokenSchema
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);

/** Binaries the command runner may execute (argv only, never a shell). */
export const allowedCommands: Set<string> = new Set(
	env.RECODER_ALLOWED_COMMANDS.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
);

/**
 * The experiment variant this review runs (`RECODER_REVIEW_VARIANT`), or null for the baseline when it is unset.
 * Read per review, so a test can switch it; a value that names no variant throws rather than run the baseline.
 */
export function reviewVariant(): ReviewVariant | null {
	const value = process.env.RECODER_REVIEW_VARIANT;
	const parsed = reviewVariantSchema.safeParse(value);

	if (!parsed.success) {
		throw new Error(`RECODER_REVIEW_VARIANT is "${value}"; it must be one of ${REVIEW_VARIANTS.join(', ')}`);
	}

	return parsed.data ?? null;
}

/**
 * The client id of the OAuth application Recoder signs in with on a forge, or undefined when none is set. Read per
 * call, so a test can switch it; a malformed value throws rather than be treated as unset.
 */
export function oauthClientId(provider: 'github' | 'gitlab'): string | undefined {
	const name = provider === 'github' ? 'RECODER_GITHUB_CLIENT_ID' : 'RECODER_GITLAB_CLIENT_ID';
	const parsed = oauthClientIdSchema.safeParse(process.env[name]);

	if (!parsed.success) throw new Error(`${name} is not a valid OAuth client id.`);

	return parsed.data;
}

/**
 * The client secret of the OAuth application Recoder signs in with on a forge, or undefined when none is set. With
 * it a forge signs in by redirect. The error names the variable, never its value.
 */
export function oauthClientSecret(provider: 'github' | 'gitlab'): string | undefined {
	const name = provider === 'github' ? 'RECODER_GITHUB_CLIENT_SECRET' : 'RECODER_GITLAB_CLIENT_SECRET';
	const parsed = oauthClientSecretSchema.safeParse(process.env[name]);

	if (!parsed.success) throw new Error(`${name} is not a valid OAuth client secret.`);

	return parsed.data;
}

/** The origin `RECODER_PUBLIC_URL` names, or undefined when it is unset. Read per call, so a test can switch it. */
export function publicOrigin(): string | undefined {
	const parsed = publicUrlSchema.safeParse(process.env.RECODER_PUBLIC_URL);

	if (!parsed.success) throw new Error('RECODER_PUBLIC_URL must be an http(s) URL.');

	return parsed.data ? new URL(parsed.data).origin : undefined;
}

/** The fixed API access token (`RECODER_API_TOKEN`), or undefined when unset. */
export function configuredApiToken(): string | undefined {
	const parsed = apiTokenSchema.safeParse(process.env.RECODER_API_TOKEN);

	if (!parsed.success) throw new Error('RECODER_API_TOKEN must be 32 to 200 characters.');

	return parsed.data;
}

/**
 * The key that seals stored credentials (`RECODER_SECRET_KEY`, 32 bytes as base64), or undefined when unset or blank.
 * The error names the variable, never its value.
 */
export function configuredSecretKey(): Buffer | undefined {
	const value = process.env.RECODER_SECRET_KEY?.trim();

	if (!value) return undefined;

	const key = decodeSecretKey(value);

	if (!key) throw new Error('RECODER_SECRET_KEY must be 32 bytes as base64 (`openssl rand -base64 32`).');

	return key;
}

/**
 * The tools this review's reviewers get (`RECODER_REVIEWER_TOOLS`): none when it is unset. Read per review, so a
 * test can switch it; a value that names no setting throws rather than run with a setting nobody chose.
 */
export function reviewerTools(): ReviewerTools {
	const value = process.env.RECODER_REVIEWER_TOOLS;
	const parsed = reviewerToolsSchema.safeParse(value);

	if (!parsed.success) {
		throw new Error(`RECODER_REVIEWER_TOOLS is "${value}"; it must be one of ${REVIEWER_TOOLS.join(', ')}`);
	}

	return parsed.data ?? 'none';
}
