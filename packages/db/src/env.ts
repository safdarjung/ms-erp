// Env is injected by the process wrapper:
//  - db scripts:  dotenv -e ../../.env -- tsx ...
//  - web app:     dotenv -e ../../.env -- next ...
// so we just read process.env here.

export const APP_DB_URL = process.env.DATABASE_URL ?? '';
export const ADMIN_DB_URL = process.env.DATABASE_URL_ADMIN ?? '';

if (!APP_DB_URL) throw new Error('DATABASE_URL is not set — load the repo-root .env');
