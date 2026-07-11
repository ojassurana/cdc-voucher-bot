export type Category = "cdc" | "supermarket" | "energy";

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_SECRET_TOKEN: string;
  WEBHOOK_SECRET: string;
  MASTER_ENCRYPTION_KEY: string;
}

export interface TelegramUser {
  id: number;
  first_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface InlineButton {
  text: string;
  callback_data?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineButton[][];
}

export interface UserRecord {
  user_key: string;
  dashboard_message_id: number | null;
  dashboard_kind: "text" | "photo";
  flow_state: string;
  flow_payload: string | null;
  created_at: string;
  updated_at: string;
}

export interface SourceRecord {
  id: string;
  user_key: string;
  fingerprint: string;
  encrypted_url: string;
  encrypted_group_id: string;
  label: string;
  campaign_name: string | null;
  expiry_date: string | null;
  created_at: string;
  refreshed_at: string;
}

export interface BalanceRecord {
  source_id: string;
  category: Category;
  available: number;
  voucher_count: number;
  denominations_json: string;
  refreshed_at: string;
}

export interface Voucher {
  id: string;
  state: string;
  type: string | null;
  value: number;
  category: Category;
  sourceId: string;
  sourceLabel: string;
  groupId: string;
  qrPrefix: string;
  aliasEnabled: boolean;
}

export interface CategoryBalance {
  category: Category;
  available: number;
  voucherCount: number;
  denominations: Record<string, number>;
}

export interface SourceSnapshot {
  sourceId: string;
  label: string;
  campaignName: string;
  expiryDate: string | null;
  groupId: string;
  qrPrefix: string;
  aliasEnabled: boolean;
  vouchers: Voucher[];
  balances: CategoryBalance[];
}

export interface DashboardRow {
  sourceId: string;
  label: string;
  expiryDate?: string | null;
  category: Category;
  available: number;
  voucherCount: number;
  refreshedAt: string;
}

export interface DashboardData {
  sourceCount: number;
  totals: Record<Category, number>;
  rows: DashboardRow[];
  refreshedAt: string | null;
}
