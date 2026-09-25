-- Hosted-version waitlist, filled by POST /api/waitlist on recoder.dev.
-- Run once against the Neon database: psql "$DATABASE_URL" -f db/waitlist.sql

create table if not exists waitlist (
	id bigint generated always as identity primary key,
	-- Stored lowercased and trimmed, so the unique constraint covers casing.
	email text not null unique
		check (email = lower(btrim(email)) and char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
	source text not null default 'recoder.dev'
		check (char_length(source) <= 64),
	created_at timestamptz not null default now()
);
