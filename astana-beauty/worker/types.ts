import type { Lang, Snapshot } from "../src/shared";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  BOOKING_ENABLED?: string;
  NOTIFICATIONS_ENABLED?: string;
  WHATSAPP_ENABLED?: string;
  SITE_URL?: string;
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
  CRON_SECRET?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TELEGRAM_OWNER_ID?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_WHATSAPP_FROM?: string;
  TWILIO_REMINDER_RU?: string;
  TWILIO_REMINDER_KK?: string;
  TWILIO_CANCEL_RU?: string;
  TWILIO_CANCEL_KK?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}
export interface Booking {
  id: string;
  token_hash: string;
  request_hash: string;
  name: string;
  phone: string;
  lang: Lang;
  services: string;
  total: number;
  duration: number;
  start_at: number;
  end_at: number;
  reserved_until: number;
  status: "confirmed" | "cancel_pending" | "cancelled";
  created_at: number;
  cancelled_at: number | null;
  whatsapp_consent_at: number | null;
}
export interface Notification {
  id: string;
  booking_id: string;
  kind: "telegram" | "reminder" | "cancel";
  status: string;
  due_at: number;
  claimed_at: number | null;
  claim_token: string | null;
}
export const serviceSnapshot = (b: Booking): Snapshot[] =>
  JSON.parse(b.services);
