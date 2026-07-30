import { defineConfig } from 'drizzle-kit';

// DATABASE_URL_ADMIN is injected by the `dotenv -e ../../.env` wrapper in the
// package scripts (single source of truth = repo-root .env).
export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL_ADMIN ?? 'postgresql://postgres:postgres@localhost:5433/mserp',
  },
  strict: true,
  verbose: true,
});
