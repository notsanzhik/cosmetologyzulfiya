import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

export const bookings = sqliteTable(
  "bookings",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    requestHash: text("request_hash").notNull(),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    lang: text("lang").notNull(),
    services: text("services").notNull(),
    total: integer("total").notNull(),
    duration: integer("duration").notNull(),
    startAt: integer("start_at").notNull(),
    endAt: integer("end_at").notNull(),
    reservedUntil: integer("reserved_until").notNull(),
    status: text("status").notNull().default("confirmed"),
    consentAt: integer("consent_at").notNull(),
    whatsappConsentAt: integer("whatsapp_consent_at"),
    createdAt: integer("created_at").notNull(),
    cancelledAt: integer("cancelled_at"),
  },
  (t) => [
    index("bookings_start_idx").on(t.startAt),
    uniqueIndex("bookings_token_idx").on(t.tokenHash),
  ],
);

// Уникальный ключ на каждом 15-минутном отрезке блокирует пересечения.
export const occupancy = sqliteTable(
  "occupancy",
  {
    startAt: integer("start_at").primaryKey(),
    bookingId: text("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
  },
  (t) => [index("occupancy_booking_idx").on(t.bookingId)],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    bookingId: text("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    dueAt: integer("due_at").notNull(),
    claimedAt: integer("claimed_at"),
    claimToken: text("claim_token"),
    providerId: text("provider_id"),
    delivery: text("delivery"),
    error: text("error"),
  },
  (t) => [
    uniqueIndex("notification_once_idx").on(t.bookingId, t.kind),
    index("notification_due_idx").on(t.status, t.dueAt),
  ],
);

export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
export const confirmations = sqliteTable("cancel_confirmations", {
  nonce: text("nonce").primaryKey(),
  bookingId: text("booking_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
