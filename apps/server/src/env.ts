import { z } from 'zod';

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
	RECODER_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000)
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);

/** Binaries the command runner may execute (argv only, never a shell). */
export const allowedCommands: Set<string> = new Set(
	env.RECODER_ALLOWED_COMMANDS.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
);
