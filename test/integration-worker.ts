import { handleTelegramUpdate } from "../src/app";
import type { TelegramPort } from "../src/telegram";
import type { Env, InlineKeyboardMarkup, TelegramUpdate } from "../src/types";

class FakeTelegram implements TelegramPort {
  private nextMessageId = 100;
  readonly calls = {
    messages: [] as Array<{ chatId: number; text: string; replyMarkup?: InlineKeyboardMarkup }>,
    richMessages: [] as Array<{ chatId: number; html: string; replyMarkup?: InlineKeyboardMarkup }>,
    richEdits: [] as Array<{ chatId: number; messageId: number; html: string; replyMarkup?: InlineKeyboardMarkup }>,
    photos: [] as Array<{ chatId: number; caption: string; byteLength: number; filename?: string; replyMarkup?: InlineKeyboardMarkup }>,
    textEdits: [] as Array<{ chatId: number; messageId: number; text: string; replyMarkup?: InlineKeyboardMarkup }>,
    captionEdits: [] as Array<{ chatId: number; messageId: number; caption: string; replyMarkup?: InlineKeyboardMarkup }>,
    photoEdits: [] as Array<{ chatId: number; messageId: number; caption: string; byteLength: number; replyMarkup?: InlineKeyboardMarkup }>,
    deleted: [] as Array<{ chatId: number; messageId: number }>,
    callbacks: [] as Array<{ callbackQueryId: string; text: string; showAlert: boolean }>,
    actions: [] as Array<{ chatId: number; action: string }>,
    commands: [] as Array<{ command: string; description: string }>,
  };

  async setCommands(commands: Array<{ command: string; description: string }>): Promise<void> {
    this.calls.commands = commands;
  }

  async sendMessage(chatId: number, text: string, replyMarkup?: InlineKeyboardMarkup): Promise<number> {
    this.calls.messages.push({ chatId, text, replyMarkup });
    return this.nextMessageId++;
  }

  async sendRichMessage(chatId: number, html: string, replyMarkup?: InlineKeyboardMarkup): Promise<number> {
    this.calls.richMessages.push({ chatId, html, replyMarkup });
    return this.nextMessageId++;
  }

  async editMessageText(chatId: number, messageId: number, text: string, replyMarkup?: InlineKeyboardMarkup): Promise<boolean> {
    this.calls.textEdits.push({ chatId, messageId, text, replyMarkup });
    return true;
  }

  async editRichMessage(chatId: number, messageId: number, html: string, replyMarkup?: InlineKeyboardMarkup): Promise<boolean> {
    this.calls.richEdits.push({ chatId, messageId, html, replyMarkup });
    return true;
  }

  async editCaption(chatId: number, messageId: number, caption: string, replyMarkup?: InlineKeyboardMarkup): Promise<boolean> {
    this.calls.captionEdits.push({ chatId, messageId, caption, replyMarkup });
    return true;
  }

  async deleteMessage(chatId: number, messageId: number): Promise<boolean> {
    this.calls.deleted.push({ chatId, messageId });
    return true;
  }

  async answerCallback(callbackQueryId: string, text = "", showAlert = false): Promise<void> {
    this.calls.callbacks.push({ callbackQueryId, text, showAlert });
  }

  async sendChatAction(chatId: number, action: "typing" | "upload_photo"): Promise<void> {
    this.calls.actions.push({ chatId, action });
  }

  async sendPhoto(
    chatId: number,
    bytes: Uint8Array,
    caption: string,
    replyMarkup?: InlineKeyboardMarkup,
    filename?: string,
  ): Promise<number> {
    this.calls.photos.push({ chatId, caption, byteLength: bytes.byteLength, filename, replyMarkup });
    return this.nextMessageId++;
  }

  async editPhoto(
    chatId: number,
    messageId: number,
    bytes: Uint8Array,
    caption: string,
    replyMarkup?: InlineKeyboardMarkup,
  ): Promise<boolean> {
    this.calls.photoEdits.push({ chatId, messageId, caption, byteLength: bytes.byteLength, replyMarkup });
    return true;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") return new Response("POST an update", { status: 405 });
    const update = await request.json<TelegramUpdate>();
    const telegram = new FakeTelegram();
    await handleTelegramUpdate(env, update, telegram);
    return Response.json(telegram.calls);
  },
};
