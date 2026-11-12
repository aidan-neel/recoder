import { z } from 'zod';

/**
 * The review shapes an experiment compares with the baseline (issue #95): `specialist-tree` has a coordinator
 * assign the reviewers' slices to domain specialists, and `independent-pass` adds a second review of every slice
 * that never sees the first pass's findings.
 */
const REVIEW_VARIANTS = ['specialist-tree', 'independent-pass'] as const;

type ReviewVariant = (typeof REVIEW_VARIANTS)[number];

const reviewVariantSchema = z.preprocess(
	(value) => (value === '' ? undefined : value),
	z.enum(REVIEW_VARIANTS).optional()
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
	RECODER_REVIEW_VARIANT: reviewVariantSchema
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
