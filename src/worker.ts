import { handleTelegramUpdate } from "./app";
import { claimUpdate, releaseUpdate } from "./db";
import type { Env, TelegramUpdate } from "./types";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "cdc-voucher-wallet", version: 1 });
    }
    if (request.method === "GET") {
      return new Response("Your private voucher wallet is running. Open the Telegram bot to continue.", {
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    }
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!env.WEBHOOK_SECRET || url.pathname !== `/webhook/${env.WEBHOOK_SECRET}`) {
      return new Response("Not found", { status: 404 });
    }
    if (!env.TELEGRAM_SECRET_TOKEN) return new Response("Service unavailable", { status: 503 });
    const sentSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
    if (sentSecret !== env.TELEGRAM_SECRET_TOKEN) return new Response("Unauthorized", { status: 401 });
    let update: TelegramUpdate;
    try {
      update = await request.json<TelegramUpdate>();
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (!Number.isSafeInteger(update.update_id)) return new Response("Bad request", { status: 400 });
    const claimed = await claimUpdate(env.DB, update.update_id);
    if (!claimed) return new Response("ok");
    try {
      await handleTelegramUpdate(env, update);
      return new Response("ok");
    } catch (error) {
      await releaseUpdate(env.DB, update.update_id);
      console.error("telegram_update_failed", {
        update_id: update.update_id,
        reason: error instanceof Error ? error.message : "unknown",
      });
      return new Response("Temporary failure", { status: 500 });
    }
  },
};
