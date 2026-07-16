import type { Category, CategoryBalance, SourceSnapshot, Voucher } from "./types";

export const REDEEM_API_BASE = "https://api-cdc.redeem.gov.sg/v1/public";
export const REDEEM_SITE_ORIGIN = "https://voucher.redeem.gov.sg";

// RedeemSG sits behind Cloudflare bot protection (Error 1010). Bare API
// fetches without browser-like Origin/Referer are rejected, which made QR
// creation and balance refresh look like "no unused balance".
function redeemHeaders(groupId?: string, extra: Record<string, string> = {}): Record<string, string> {
  const referer = groupId
    ? `${REDEEM_SITE_ORIGIN}/${encodeURIComponent(groupId)}?lang=en-GB`
    : `${REDEEM_SITE_ORIGIN}/`;
  return {
    accept: "application/json",
    origin: REDEEM_SITE_ORIGIN,
    referer,
    "user-agent":
      "Mozilla/5.0 (compatible; CDCVoucherBot/1.0; +https://t.me/cdc_voucherbot)",
    ...extra,
  };
}

interface RawVoucher {
  id?: unknown;
  state?: unknown;
  type?: unknown;
  voucher_value?: unknown;
  voucherValue?: unknown;
  expiry_date?: unknown;
  expiryDate?: unknown;
  expires_at?: unknown;
  expiresAt?: unknown;
}

interface RawVoucherGroup {
  campaign?: Record<string, unknown>;
  data?: { vouchers?: RawVoucher[] };
}

export function extractGroupId(input: string): string {
  const raw = String(input || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return "";
    if (!(parsed.hostname === "voucher.redeem.gov.sg" || parsed.hostname.endsWith(".redeem.gov.sg"))) return "";
    return parsed.pathname.split("/").filter(Boolean)[0] || "";
  } catch {
    return "";
  }
}

export function normalizeVoucherUrl(input: string, groupId: string): string {
  const parsed = new URL(input);
  parsed.hash = "";
  if (!parsed.searchParams.has("lang")) parsed.searchParams.set("lang", "en-GB");
  if (!parsed.pathname.split("/").filter(Boolean)[0]) {
    parsed.pathname = `/${encodeURIComponent(groupId)}`;
  }
  return parsed.toString();
}

export async function fetchVoucherGroup(groupId: string, fetcher: typeof fetch = fetch): Promise<RawVoucherGroup> {
  const response = await fetcher(`${REDEEM_API_BASE}/vouchers/groups/${encodeURIComponent(groupId)}`, {
    headers: redeemHeaders(groupId),
  });
  if (!response.ok) throw new Error(`RedeemSG returned HTTP ${response.status}`);
  return response.json<RawVoucherGroup>();
}

function campaignValue(campaign: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = campaign[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function dateValue(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function expiryDate(group: RawVoucherGroup): string | null {
  const campaign = group.campaign || {};
  const keys = ["end_date", "endDate", "valid_until", "validUntil", "expiry_date", "expiryDate", "expires_at", "expiresAt"];
  for (const key of keys) {
    const value = dateValue(campaign[key]);
    if (value) return value;
  }
  for (const voucher of group.data?.vouchers || []) {
    for (const key of keys) {
      const value = dateValue(voucher[key as keyof RawVoucher]);
      if (value) return value;
    }
  }
  return null;
}

export function campaignName(group: RawVoucherGroup): string {
  const campaign = group.campaign || {};
  return campaignValue(campaign, "name", "title", "campaign_name", "campaignName") || "Voucher tranche";
}

function categoryFor(type: string | null, name: string): Category | null {
  const normalized = String(type || "").toLowerCase();
  if (normalized === "heartland" || normalized === "cdc") return "cdc";
  if (normalized === "supermarket" || normalized === "market") return "supermarket";
  if (normalized === "energy" || normalized === "climate" || normalized === "utilities") return "energy";
  if (!normalized && /climate|energy|utilities/i.test(name)) return "energy";
  return null;
}

function countValues(vouchers: Voucher[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const voucher of vouchers) counts[String(voucher.value)] = (counts[String(voucher.value)] || 0) + 1;
  return counts;
}

export function snapshotVoucherGroup(
  sourceId: string,
  sourceLabel: string,
  groupId: string,
  group: RawVoucherGroup,
): SourceSnapshot {
  const name = campaignName(group);
  const expiry = expiryDate(group);
  const campaign = group.campaign || {};
  const extraPrefix = campaignValue(campaign, "extra_qr_prefix", "extraQrPrefix");
  const qrPrefix = `rsg${extraPrefix ? `-${extraPrefix}` : ""}`;
  const aliasEnabled = Boolean(campaign.is_voucher_alias_enabled ?? campaign.isVoucherAliasEnabled);
  const vouchers: Voucher[] = [];
  for (const raw of group.data?.vouchers || []) {
    const type = typeof raw.type === "string" ? raw.type : null;
    const category = categoryFor(type, name);
    const id = typeof raw.id === "string" ? raw.id : "";
    const value = Number(raw.voucher_value ?? raw.voucherValue ?? 0);
    if (!category || !id || !Number.isFinite(value) || value <= 0) continue;
    vouchers.push({
      id,
      state: String(raw.state || ""),
      type,
      value,
      category,
      sourceId,
      sourceLabel,
      groupId,
      qrPrefix,
      aliasEnabled,
    });
  }
  const balances: CategoryBalance[] = (["cdc", "supermarket", "energy"] as Category[])
    .map((category) => {
      const unused = vouchers.filter((voucher) => voucher.category === category && voucher.state === "unused");
      return {
        category,
        available: unused.reduce((sum, voucher) => sum + voucher.value, 0),
        voucherCount: unused.length,
        denominations: countValues(unused),
      };
    })
    .filter((balance) => balance.voucherCount > 0 || vouchers.some((voucher) => voucher.category === balance.category));
  if (!balances.length) throw new Error("This link does not contain a supported CDC, supermarket, or energy voucher");
  return { sourceId, label: sourceLabel, campaignName: name, expiryDate: expiry, groupId, qrPrefix, aliasEnabled, vouchers, balances };
}

export async function createAliasPayload(
  snapshot: SourceSnapshot,
  vouchers: Voucher[],
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const response = await fetcher(`${REDEEM_API_BASE}/vouchers/groups/alias`, {
    method: "POST",
    headers: redeemHeaders(snapshot.groupId, { "content-type": "application/json" }),
    body: JSON.stringify({ group_id: snapshot.groupId, voucher_ids: vouchers.map((voucher) => voucher.id) }),
  });
  if (!response.ok) throw new Error(`RedeemSG alias endpoint returned HTTP ${response.status}`);
  const body = await response.json<{ alias?: string; data?: { alias?: string } }>();
  const alias = body.alias || body.data?.alias;
  if (!alias) throw new Error("RedeemSG did not return a QR alias");
  return `${snapshot.qrPrefix}:${alias}`;
}
