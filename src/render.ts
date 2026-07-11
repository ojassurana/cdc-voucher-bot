import { Resvg } from "@cf-wasm/resvg/workerd";
import interFont from "./assets/inter.woff2";
import type { Category, DashboardData } from "./types";

const CATEGORY_META: Record<Category, { label: string; accent: string; soft: string }> = {
  cdc: { label: "CDC / HEARTLAND", accent: "#67E8A5", soft: "#14352E" },
  supermarket: { label: "SUPERMARKET", accent: "#62C8FF", soft: "#123149" },
  energy: { label: "ENERGY", accent: "#C5A3FF", soft: "#2E2548" },
};

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&apos;",
    };
    return entities[character] || character;
  });
}

function shortLabel(value: string, limit = 45): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

function money(value: number): string {
  return `$${Math.max(0, Math.round(value)).toLocaleString("en-SG")}`;
}

function updatedText(timestamp: string | null): string {
  if (!timestamp) return "Not refreshed yet";
  const date = new Date(timestamp);
  return `Updated ${date.toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

export function dashboardSvg(data: DashboardData): string {
  const categories: Category[] = ["cdc", "supermarket", "energy"];
  const sectionHeights = categories.map((category) => {
    const count = Math.max(1, data.rows.filter((row) => row.category === category).length);
    return 174 + count * 58;
  });
  const height = 250 + sectionHeights.reduce((sum, value) => sum + value, 0) + 46;
  let y = 220;
  const sections = categories
    .map((category, index) => {
      const meta = CATEGORY_META[category];
      const rows = data.rows.filter((row) => row.category === category);
      const heightForSection = sectionHeights[index] || 232;
      const rowMarkup = rows.length
        ? rows
            .map((row, rowIndex) => {
              const rowY = y + 148 + rowIndex * 58;
              return `
                <line x1="92" x2="988" y1="${rowY - 25}" y2="${rowY - 25}" stroke="#253344" stroke-width="1"/>
                <text x="92" y="${rowY + 7}" class="row-label">${escapeXml(shortLabel(row.label))}</text>
                <text x="988" y="${rowY + 7}" class="row-value" text-anchor="end">${money(row.available)}</text>`;
            })
            .join("")
        : `<text x="92" y="${y + 167}" class="empty">No vouchers added yet</text>`;
      const markup = `
        <rect x="52" y="${y}" width="976" height="${heightForSection - 20}" rx="30" fill="#101D2C" stroke="#203247" stroke-width="2"/>
        <rect x="76" y="${y + 28}" width="18" height="72" rx="9" fill="${meta.accent}"/>
        <rect x="110" y="${y + 28}" width="260" height="38" rx="19" fill="${meta.soft}"/>
        <text x="130" y="${y + 55}" class="category" fill="${meta.accent}">${meta.label}</text>
        <text x="110" y="${y + 112}" class="balance">${money(data.totals[category])}</text>
        <text x="988" y="${y + 102}" class="hint" text-anchor="end">${rows.length} ${rows.length === 1 ? "tranche" : "tranches"}</text>
        ${rowMarkup}`;
      y += heightForSection;
      return markup;
    })
    .join("");
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${height}" viewBox="0 0 1080 ${height}">
    <defs>
      <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#07111D"/>
        <stop offset="1" stop-color="#0B1826"/>
      </linearGradient>
      <style>
        text { font-family: Inter, sans-serif; }
        .eyebrow { font-size: 24px; font-weight: 650; letter-spacing: 5px; fill: #67E8A5; }
        .title { font-size: 64px; font-weight: 720; letter-spacing: -2px; fill: #F8FBFF; }
        .sub { font-size: 25px; font-weight: 460; fill: #91A2B6; }
        .category { font-size: 20px; font-weight: 720; letter-spacing: 2px; }
        .balance { font-size: 50px; font-weight: 720; fill: #F8FBFF; }
        .hint { font-size: 22px; font-weight: 480; fill: #7E91A7; }
        .row-label { font-size: 23px; font-weight: 520; fill: #CDD8E5; }
        .row-value { font-size: 24px; font-weight: 680; fill: #F8FBFF; }
        .empty { font-size: 23px; font-weight: 480; fill: #66798F; }
      </style>
    </defs>
    <rect width="1080" height="${height}" fill="url(#background)"/>
    <circle cx="970" cy="60" r="180" fill="#123A34" opacity="0.35"/>
    <text x="52" y="66" class="eyebrow">MY CDC BANK</text>
    <text x="52" y="136" class="title">Balances at a glance</text>
    <text x="52" y="181" class="sub">${escapeXml(updatedText(data.refreshedAt))} · ${data.sourceCount} saved ${data.sourceCount === 1 ? "voucher" : "vouchers"}</text>
    ${sections}
  </svg>`;
}

export async function renderDashboardPng(data: DashboardData): Promise<Uint8Array> {
  const renderer = await Resvg.async(dashboardSvg(data), {
    font: {
      fontBuffers: [new Uint8Array(interFont)],
      defaultFontFamily: "Inter",
      sansSerifFamily: "Inter",
      loadSystemFonts: false,
    },
    fitTo: { mode: "original" },
  });
  return renderer.render().asPng();
}

export function dashboardCaption(data: DashboardData): string {
  return [
    "<b>Your CDC Bank</b>",
    "Everything is private and ready when you need it.",
    "",
    `<i>${escapeXml(updatedText(data.refreshedAt))}</i>`,
  ].join("\n");
}

export const ONBOARDING_TEXT = [
  "<h2>🏦 Your CDC Bank</h2>",
  "Keep vouchers together, check balances, and create a QR in seconds.",
  "",
  "Add your first voucher to begin.",
].join("\n");
