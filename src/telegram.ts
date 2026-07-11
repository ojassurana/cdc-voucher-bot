import type { InlineKeyboardMarkup } from "./types";

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface TelegramMessageResult {
  message_id: number;
}

function isUnchangedMessage(error: unknown): boolean {
  return error instanceof Error && /message is not modified/i.test(error.message);
}

export interface TelegramPort {
  setCommands(commands: Array<{ command: string; description: string }>): Promise<void>;
  sendMessage(chatId: number, text: string, replyMarkup?: InlineKeyboardMarkup): Promise<number>;
  sendRichMessage(chatId: number, html: string, replyMarkup?: InlineKeyboardMarkup): Promise<number>;
  editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<boolean>;
  editRichMessage(
    chatId: number,
    messageId: number,
    html: string,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<boolean>;
  editCaption(
    chatId: number,
    messageId: number,
    caption: string,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<boolean>;
  deleteMessage(chatId: number, messageId: number): Promise<boolean>;
  answerCallback(callbackQueryId: string, text?: string, showAlert?: boolean): Promise<void>;
  sendChatAction(chatId: number, action: "typing" | "upload_photo"): Promise<void>;
  sendPhoto(
    chatId: number,
    bytes: Uint8Array,
    caption: string,
    replyMarkup?: InlineKeyboardMarkup,
    filename?: string,
  ): Promise<number>;
  editPhoto(
    chatId: number,
    messageId: number,
    bytes: Uint8Array,
    caption: string,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<boolean>;
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

export class TelegramClient implements TelegramPort {
  constructor(private readonly token: string) {}

  private endpoint(method: string): string {
    if (!this.token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
    return `https://api.telegram.org/bot${this.token}/${method}`;
  }

  private async json<T>(method: string, body: unknown): Promise<T> {
    const response = await fetch(this.endpoint(method), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result: TelegramResponse<T> = await response
      .json<TelegramResponse<T>>()
      .catch(() => ({ ok: false }));
    if (!response.ok || !result.ok || result.result === undefined) {
      throw new Error(`Telegram ${method} failed with HTTP ${response.status}: ${result.description || "unknown error"}`);
    }
    return result.result;
  }

  async setCommands(commands: Array<{ command: string; description: string }>): Promise<void> {
    await this.json<boolean>("setMyCommands", { commands });
  }

  async sendMessage(chatId: number, text: string, replyMarkup?: InlineKeyboardMarkup): Promise<number> {
    const result = await this.json<TelegramMessageResult>("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: replyMarkup,
    });
    return result.message_id;
  }

  async sendRichMessage(chatId: number, html: string, replyMarkup?: InlineKeyboardMarkup): Promise<number> {
    const result = await this.json<TelegramMessageResult>("sendRichMessage", {
      chat_id: chatId,
      rich_message: { html, skip_entity_detection: true },
      reply_markup: replyMarkup,
    });
    return result.message_id;
  }

  async editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<boolean> {
    try {
      await this.json<TelegramMessageResult>("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: replyMarkup,
      });
      return true;
    } catch (error) {
      return isUnchangedMessage(error);
    }
  }

  async editRichMessage(
    chatId: number,
    messageId: number,
    html: string,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<boolean> {
    try {
      await this.json<TelegramMessageResult>("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        rich_message: { html, skip_entity_detection: true },
        reply_markup: replyMarkup,
      });
      return true;
    } catch (error) {
      return isUnchangedMessage(error);
    }
  }

  async editCaption(
    chatId: number,
    messageId: number,
    caption: string,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<boolean> {
    try {
      await this.json<TelegramMessageResult>("editMessageCaption", {
        chat_id: chatId,
        message_id: messageId,
        caption,
        parse_mode: "HTML",
        reply_markup: replyMarkup,
      });
      return true;
    } catch (error) {
      return isUnchangedMessage(error);
    }
  }

  async deleteMessage(chatId: number, messageId: number): Promise<boolean> {
    try {
      return await this.json<boolean>("deleteMessage", { chat_id: chatId, message_id: messageId });
    } catch {
      return false;
    }
  }

  async answerCallback(callbackQueryId: string, text = "", showAlert = false): Promise<void> {
    try {
      await this.json<boolean>("answerCallbackQuery", {
        callback_query_id: callbackQueryId,
        text,
        show_alert: showAlert,
      });
    } catch {
      // Callback acknowledgements are best-effort and contain no sensitive state.
    }
  }

  async sendChatAction(chatId: number, action: "typing" | "upload_photo"): Promise<void> {
    try {
      await this.json<boolean>("sendChatAction", { chat_id: chatId, action });
    } catch {
      // Cosmetic only.
    }
  }

  async sendPhoto(
    chatId: number,
    bytes: Uint8Array,
    caption: string,
    replyMarkup?: InlineKeyboardMarkup,
    filename = "voucher-wallet.png",
  ): Promise<number> {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
    if (replyMarkup) form.append("reply_markup", JSON.stringify(replyMarkup));
    form.append("photo", new Blob([toArrayBuffer(bytes)], { type: "image/png" }), filename);
    const response = await fetch(this.endpoint("sendPhoto"), { method: "POST", body: form });
    const result: TelegramResponse<TelegramMessageResult> = await response
      .json<TelegramResponse<TelegramMessageResult>>()
      .catch(() => ({ ok: false }));
    if (!response.ok || !result.ok || !result.result) {
      throw new Error(`Telegram sendPhoto failed with HTTP ${response.status}`);
    }
    return result.result.message_id;
  }

  async editPhoto(
    chatId: number,
    messageId: number,
    bytes: Uint8Array,
    caption: string,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<boolean> {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("message_id", String(messageId));
    form.append(
      "media",
      JSON.stringify({ type: "photo", media: "attach://dashboard", caption, parse_mode: "HTML" }),
    );
    if (replyMarkup) form.append("reply_markup", JSON.stringify(replyMarkup));
    form.append("dashboard", new Blob([toArrayBuffer(bytes)], { type: "image/png" }), "voucher-wallet.png");
    try {
      const response = await fetch(this.endpoint("editMessageMedia"), { method: "POST", body: form });
      const result: TelegramResponse<TelegramMessageResult> = await response
        .json<TelegramResponse<TelegramMessageResult>>()
        .catch(() => ({ ok: false }));
      return (response.ok && result.ok) || /message is not modified/i.test(result.description || "");
    } catch (error) {
      return isUnchangedMessage(error);
    }
  }
}
