import { describe, expect, it } from "vitest";
import { deriveUserKey, fingerprintGroup, open, seal, signCallback, verifyCallback } from "../src/crypto";
import { extractGroupId, snapshotVoucherGroup } from "../src/redeem";
import { qrPayloadToPng } from "../src/qr";
import { selectBestAtOrBelow, selectPaymentPlan } from "../src/selection";
import type { Voucher } from "../src/types";

const MASTER_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

function voucher(overrides: Partial<Voucher>): Voucher {
  return {
    id: crypto.randomUUID(),
    state: "unused",
    type: "heartland",
    value: 2,
    category: "cdc",
    sourceId: "source-a",
    sourceLabel: "January vouchers",
    groupId: "group-a",
    qrPrefix: "rsg",
    aliasEnabled: false,
    ...overrides,
  };
}

describe("private storage primitives", () => {
  it("encrypts values with contextual authentication", async () => {
    const sealed = await seal(MASTER_KEY, "https://voucher.redeem.gov.sg/private", "user:source:url");
    expect(sealed).not.toContain("redeem.gov.sg");
    await expect(open(MASTER_KEY, sealed, "user:source:url")).resolves.toBe(
      "https://voucher.redeem.gov.sg/private",
    );
    await expect(open(MASTER_KEY, sealed, "other-user:source:url")).rejects.toThrow();
  });

  it("derives stable, isolated identities and fingerprints", async () => {
    await expect(deriveUserKey(MASTER_KEY, 123)).resolves.toBe(await deriveUserKey(MASTER_KEY, 123));
    expect(await deriveUserKey(MASTER_KEY, 123)).not.toBe(await deriveUserKey(MASTER_KEY, 124));
    expect(await fingerprintGroup(MASTER_KEY, "group-1")).not.toContain("group-1");
  });

  it("binds callback buttons to their owning user", async () => {
    const signed = await signCallback(MASTER_KEY, "user-a", "src:123");
    await expect(verifyCallback(MASTER_KEY, "user-a", signed)).resolves.toBe("src:123");
    await expect(verifyCallback(MASTER_KEY, "user-b", signed)).resolves.toBeNull();
  });
});

describe("voucher discovery", () => {
  it("accepts only HTTPS RedeemSG voucher links", () => {
    expect(extractGroupId("https://voucher.redeem.gov.sg/group_123?lang=en-GB")).toBe("group_123");
    expect(extractGroupId("http://voucher.redeem.gov.sg/group_123")).toBe("");
    expect(extractGroupId("https://example.com/group_123")).toBe("");
  });

  it("splits one mixed tranche across CDC and supermarket balances", () => {
    const snapshot = snapshotVoucherGroup("source-a", "CDC January", "group-a", {
      campaign: { name: "CDC Vouchers 2026 (January)" },
      data: {
        vouchers: [
          { id: "h1", state: "unused", type: "heartland", voucher_value: 5 },
          { id: "h2", state: "used", type: "heartland", voucher_value: 10 },
          { id: "s1", state: "unused", type: "supermarket", voucher_value: 10 },
        ],
      },
    });
    expect(snapshot.balances).toEqual([
      { category: "cdc", available: 5, voucherCount: 1, denominations: { "5": 1 } },
      { category: "supermarket", available: 10, voucherCount: 1, denominations: { "10": 1 } },
    ]);
  });

  it("recognises untyped climate vouchers as energy", () => {
    const snapshot = snapshotVoucherGroup("source-e", "Energy", "group-e", {
      campaign: { name: "Climate Vouchers ($300)" },
      data: { vouchers: [{ id: "e1", state: "unused", type: null, voucher_value: 50 }] },
    });
    expect(snapshot.balances[0]).toMatchObject({ category: "energy", available: 50 });
  });

  it("keeps the campaign expiry date for the dashboard", () => {
    const snapshot = snapshotVoucherGroup("source-date", "June vouchers", "group-date", {
      campaign: { name: "CDC Vouchers 2026 (June)", end_date: "2026-12-31" },
      data: { vouchers: [{ id: "d1", state: "unused", type: "heartland", voucher_value: 10 }] },
    });
    expect(snapshot.expiryDate).toBe("2026-12-31T00:00:00.000Z");
  });
});

describe("QR selection", () => {
  it("prefers an exact amount with the fewest vouchers", () => {
    const result = selectBestAtOrBelow([
      voucher({ id: "a", value: 10 }),
      voucher({ id: "b", value: 5 }),
      voucher({ id: "c", value: 5 }),
      voucher({ id: "d", value: 20 }),
    ], 20);
    expect(result?.exact).toBe(true);
    expect(result?.vouchers.map((item) => item.id)).toEqual(["d"]);
  });

  it("chooses the largest safe amount below the request", () => {
    const result = selectBestAtOrBelow([voucher({ value: 10 }), voucher({ value: 5 })], 18);
    expect(result).toMatchObject({ selectedAmount: 15, exact: false });
  });

  it("never combines alias-enabled vouchers from different sources", () => {
    const result = selectBestAtOrBelow([
      voucher({ sourceId: "source-a", aliasEnabled: true, value: 10 }),
      voucher({ sourceId: "source-b", aliasEnabled: true, value: 10 }),
    ], 20);
    expect(result).toMatchObject({ selectedAmount: 10, exact: false });
  });

  it("splits an exact payment across two voucher tranches when needed", () => {
    const plan = selectPaymentPlan([
      voucher({ id: "first", sourceId: "june", sourceLabel: "CDC June", value: 100 }),
      voucher({ id: "second", sourceId: "july", sourceLabel: "CDC July", value: 98 }),
    ], 198);
    expect(plan).toMatchObject({ selectedAmount: 198, exact: true });
    expect(plan?.selections.map((selection) => selection.selectedAmount)).toEqual([100, 98]);
  });
});

describe("QR image", () => {
  it("emits a valid PNG signature", () => {
    const image = qrPayloadToPng("rsg:test-voucher");
    expect([...image.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });
});
