export interface NotificationJob {
  userId: string;
  wordId: number;
  dateKey: string;
}

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  NOTIFICATION_QUEUE: Queue<NotificationJob>;
  APP_ENV: string;
  CORS_ALLOW_ORIGIN: string;
  SESSION_TTL_DAYS: string;
  SESSION_SECRET: string;
  SESSION_COOKIE_SAMESITE: string;
  COOKIE_SECURE: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
  GOOGLE_CLIENT_ID: string;
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_FROM: string;
}
