import { renderDashboardPng } from "../src/render";
import type { DashboardData } from "../src/types";

const fixture: DashboardData = {
  sourceCount: 3,
  totals: { cdc: 42, supermarket: 65, energy: 150 },
  refreshedAt: "2026-07-11T00:20:00+08:00",
  rows: [
    { sourceId: "1", label: "CDC Vouchers 2026 (January)", category: "cdc", available: 42, voucherCount: 7, refreshedAt: "2026-07-11T00:20:00+08:00" },
    { sourceId: "1", label: "CDC Vouchers 2026 (January)", category: "supermarket", available: 25, voucherCount: 3, refreshedAt: "2026-07-11T00:20:00+08:00" },
    { sourceId: "2", label: "SG60 Vouchers (Adults)", category: "supermarket", available: 40, voucherCount: 4, refreshedAt: "2026-07-11T00:20:00+08:00" },
    { sourceId: "3", label: "Climate Vouchers ($300)", category: "energy", available: 150, voucherCount: 5, refreshedAt: "2026-07-11T00:20:00+08:00" },
  ],
};

export default {
  async fetch(): Promise<Response> {
    const image = await renderDashboardPng(fixture);
    const copy = new Uint8Array(image.byteLength);
    copy.set(image);
    return new Response(copy.buffer, { headers: { "content-type": "image/png" } });
  },
};
