import type { Identity } from "../shared/domain";
export interface Bindings {
  DB: D1Database;
  ASSETS: Fetcher;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  NOTIFICATIONS_ENABLED?: string;
  BOOTSTRAP_TELEGRAM_ID?: string;
  APP_ENV: string;
  APP_ORIGIN: string;
}
export type AppEnv = {
  Bindings: Bindings;
  Variables: { identity: Identity; rawBody: string };
};
