import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, serial, text, boolean, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  igUserId: text("ig_user_id").notNull().unique(),
  username: text("username").notNull(),
  tokenEnc: text("token_enc").notNull(),
  tokenExpiresAt: timestamp("token_expires_at").notNull(),
});
export const automations = pgTable("automations", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  mediaId: text("media_id").notNull(),
  mediaLabel: text("media_label").notNull().default(""),
  triggers: text("triggers").array().notNull(),
  replies: text("replies").array().notNull(),
  dmText: text("dm_text").notNull().default(""),
  buttons: jsonb("buttons").$type<{ title: string; url: string }[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const handled = pgTable("handled_comments", {
  commentId: text("comment_id").primaryKey(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const files = pgTable("files", {
  id: text("id").primaryKey(),
  accountId: integer("account_id").notNull(),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  data: text("data").notNull(),
});
export const logs = pgTable("logs", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull(),
  line: text("line").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export const db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL }));