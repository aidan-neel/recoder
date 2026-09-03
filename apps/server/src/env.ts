import { z } from 'zod';

const envSchema = z.object({
	PORT: z.coerce.number().int().positive().default(3001),
	HOST: z.string().default('0.0.0.0'),
	FRONTEND_URL: z.string().default('http://localhost:3000'),
	GITHUB_WEBHOOK_SECRET: z.string().optional(),
	RECODER_WORKDIR: z.string().default('/tmp/recoder-work'),
	RECODER_ALLOWED_COMMANDS: z.string().default('echo,git,gh,bun'),
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
