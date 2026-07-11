import type {
  Category,
  DashboardData,
  DashboardRow,
  SourceRecord,
  SourceSnapshot,
  UserRecord,
} from "./types";

function now(): string {
  return new Date().toISOString();
}

export async function claimUpdate(db: D1Database, updateId: number): Promise<boolean> {
  const result = await db
    .prepare("INSERT OR IGNORE INTO processed_updates (update_id, processed_at) VALUES (?, ?)")
    .bind(updateId, now())
    .run();
  return Number(result.meta.changes || 0) === 1;
}

export async function releaseUpdate(db: D1Database, updateId: number): Promise<void> {
  await db.prepare("DELETE FROM processed_updates WHERE update_id = ?").bind(updateId).run();
}

export async function ensureUser(db: D1Database, userKey: string): Promise<UserRecord> {
  const timestamp = now();
  await db
    .prepare(
      `INSERT INTO users (user_key, created_at, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_key) DO UPDATE SET updated_at = excluded.updated_at`,
    )
    .bind(userKey, timestamp, timestamp)
    .run();
  const user = await db.prepare("SELECT * FROM users WHERE user_key = ?").bind(userKey).first<UserRecord>();
  if (!user) throw new Error("Failed to create user account");
  return user;
}

export async function setFlowState(
  db: D1Database,
  userKey: string,
  state: string,
  payload: string | null = null,
): Promise<void> {
  await db
    .prepare("UPDATE users SET flow_state = ?, flow_payload = ?, updated_at = ? WHERE user_key = ?")
    .bind(state, payload, now(), userKey)
    .run();
}

export async function setDashboardMessage(
  db: D1Database,
  userKey: string,
  messageId: number,
  kind: "text" | "photo",
): Promise<void> {
  await db
    .prepare(
      "UPDATE users SET dashboard_message_id = ?, dashboard_kind = ?, updated_at = ? WHERE user_key = ?",
    )
    .bind(messageId, kind, now(), userKey)
    .run();
}

export async function sourceByFingerprint(
  db: D1Database,
  userKey: string,
  fingerprint: string,
): Promise<SourceRecord | null> {
  return db
    .prepare("SELECT * FROM voucher_sources WHERE user_key = ? AND fingerprint = ?")
    .bind(userKey, fingerprint)
    .first<SourceRecord>();
}

export async function sourceById(
  db: D1Database,
  userKey: string,
  sourceId: string,
): Promise<SourceRecord | null> {
  return db
    .prepare("SELECT * FROM voucher_sources WHERE user_key = ? AND id = ?")
    .bind(userKey, sourceId)
    .first<SourceRecord>();
}

export async function listSources(db: D1Database, userKey: string): Promise<SourceRecord[]> {
  const result = await db
    .prepare("SELECT * FROM voucher_sources WHERE user_key = ? ORDER BY created_at DESC")
    .bind(userKey)
    .all<SourceRecord>();
  return result.results || [];
}

export async function insertSource(
  db: D1Database,
  input: {
    id: string;
    userKey: string;
    fingerprint: string;
    encryptedUrl: string;
    encryptedGroupId: string;
    label: string;
    campaignName: string;
    expiryDate: string | null;
  },
): Promise<SourceRecord> {
  const timestamp = now();
  await db
    .prepare(
      `INSERT INTO voucher_sources
         (id, user_key, fingerprint, encrypted_url, encrypted_group_id, label, campaign_name, expiry_date, created_at, refreshed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.userKey,
      input.fingerprint,
      input.encryptedUrl,
      input.encryptedGroupId,
      input.label,
      input.campaignName,
      input.expiryDate,
      timestamp,
      timestamp,
    )
    .run();
  const source = await sourceById(db, input.userKey, input.id);
  if (!source) throw new Error("Failed to save voucher source");
  return source;
}

export async function updateSourceSnapshot(
  db: D1Database,
  source: SourceRecord,
  snapshot: SourceSnapshot,
): Promise<void> {
  const timestamp = now();
  const statements = [
    db
      .prepare("UPDATE voucher_sources SET label = ?, campaign_name = ?, expiry_date = ?, refreshed_at = ? WHERE id = ?")
      .bind(snapshot.label, snapshot.campaignName, snapshot.expiryDate, timestamp, source.id),
    db.prepare("DELETE FROM voucher_balances WHERE source_id = ?").bind(source.id),
    ...snapshot.balances.map((balance) =>
      db
        .prepare(
          `INSERT INTO voucher_balances
             (source_id, category, available, voucher_count, denominations_json, refreshed_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          source.id,
          balance.category,
          balance.available,
          balance.voucherCount,
          JSON.stringify(balance.denominations),
          timestamp,
        ),
    ),
  ];
  await db.batch(statements);
}

export async function deleteSource(db: D1Database, userKey: string, sourceId: string): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM voucher_sources WHERE user_key = ? AND id = ?")
    .bind(userKey, sourceId)
    .run();
  return Number(result.meta.changes || 0) > 0;
}

interface DashboardQueryRow {
  source_id: string;
  label: string;
  expiry_date: string | null;
  category: Category;
  available: number;
  voucher_count: number;
  refreshed_at: string;
}

export async function dashboardData(db: D1Database, userKey: string): Promise<DashboardData> {
  const sourceCountRow = await db
    .prepare("SELECT COUNT(*) AS count FROM voucher_sources WHERE user_key = ?")
    .bind(userKey)
    .first<{ count: number }>();
  const result = await db
    .prepare(
      `SELECT s.id AS source_id, s.label, s.expiry_date, b.category, b.available, b.voucher_count, b.refreshed_at
       FROM voucher_sources s
       JOIN voucher_balances b ON b.source_id = s.id
       WHERE s.user_key = ?
       ORDER BY b.category, s.created_at DESC`,
    )
    .bind(userKey)
    .all<DashboardQueryRow>();
  const rows: DashboardRow[] = (result.results || []).map((row) => ({
    sourceId: row.source_id,
    label: row.label,
    expiryDate: row.expiry_date,
    category: row.category,
    available: Number(row.available),
    voucherCount: Number(row.voucher_count),
    refreshedAt: row.refreshed_at,
  }));
  const totals: Record<Category, number> = { cdc: 0, supermarket: 0, energy: 0 };
  let refreshedAt: string | null = null;
  for (const row of rows) {
    totals[row.category] += row.available;
    if (!refreshedAt || row.refreshedAt < refreshedAt) refreshedAt = row.refreshedAt;
  }
  return { sourceCount: Number(sourceCountRow?.count || 0), totals, rows, refreshedAt };
}

export async function balancesForSource(
  db: D1Database,
  userKey: string,
  sourceId: string,
): Promise<Array<{ category: Category; available: number; voucherCount: number }>> {
  const result = await db
    .prepare(
      `SELECT b.category, b.available, b.voucher_count
       FROM voucher_balances b
       JOIN voucher_sources s ON s.id = b.source_id
       WHERE s.user_key = ? AND s.id = ?
       ORDER BY b.category`,
    )
    .bind(userKey, sourceId)
    .all<{ category: Category; available: number; voucher_count: number }>();
  return (result.results || []).map((row) => ({
    category: row.category,
    available: Number(row.available),
    voucherCount: Number(row.voucher_count),
  }));
}
