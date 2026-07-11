import {
  balancesForSource,
  dashboardData,
  deleteSource,
  ensureUser,
  insertSource,
  listSources,
  setDashboardMessage,
  setFlowState,
  sourceByFingerprint,
  sourceById,
  updateSourceSnapshot,
} from "./db";
import { deriveUserKey, fingerprintGroup, open, seal, signCallback, verifyCallback } from "./crypto";
import {
  campaignName,
  createAliasPayload,
  extractGroupId,
  fetchVoucherGroup,
  normalizeVoucherUrl,
  snapshotVoucherGroup,
} from "./redeem";
import { ONBOARDING_TEXT } from "./render";
import { qrPayloadToPng } from "./qr";
import { parseAmount, selectPaymentPlan, type SelectionResult } from "./selection";
import { TelegramClient, type TelegramPort } from "./telegram";
import type {
  Category,
  Env,
  InlineButton,
  InlineKeyboardMarkup,
  SourceRecord,
  SourceSnapshot,
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramUpdate,
  UserRecord,
} from "./types";

const CATEGORY_LABEL: Record<Category, string> = {
  cdc: "CDC / Heartland",
  supermarket: "Supermarket",
  energy: "Energy",
};

const QUICK_AMOUNTS = [2, 5, 10, 20, 30, 50, 80, 100, 150, 200, 250, 300];

interface StoredQrStep {
  payload: string;
  amount: number;
  tranche: string;
}

interface StoredQrMessages {
  messageIds: number[];
}

export const BOT_COMMANDS = [
  { command: "start", description: "Open your CDC Bank" },
  { command: "dashboard", description: "Open your CDC Bank" },
  { command: "cdc", description: "Create a CDC / Heartland QR" },
  { command: "supermarket", description: "Create a Supermarket QR" },
  { command: "energy", description: "Create an Energy QR" },
];

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] || character;
  });
}

function shortLabel(value: string, limit = 42): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

async function button(env: Env, userKey: string, text: string, payload: string): Promise<InlineButton> {
  return { text, callback_data: await signCallback(env.MASTER_ENCRYPTION_KEY, userKey, payload) };
}

async function homeKeyboard(env: Env, userKey: string): Promise<InlineKeyboardMarkup> {
  return {
    inline_keyboard: [
      [
        await button(env, userKey, "↻ Refresh balances", "bal"),
        await button(env, userKey, "+ Add voucher", "add"),
      ],
      [
        await button(env, userKey, "My vouchers", "list"),
        await button(env, userKey, "Create QR", "qr"),
      ],
    ],
  };
}

async function onboardingKeyboard(env: Env, userKey: string): Promise<InlineKeyboardMarkup> {
  return { inline_keyboard: [[await button(env, userKey, "＋ Add your first voucher", "add")]] };
}

async function showPanelHtml(
  env: Env,
  telegram: TelegramPort,
  chatId: number,
  user: UserRecord,
  html: string,
  keyboard: InlineKeyboardMarkup,
): Promise<void> {
  // Telegram cannot turn a photo message into a rich message. QR images are
  // temporary, so remove that photo panel before restoring the rich panel.
  if (user.dashboard_message_id && user.dashboard_kind === "text") {
    const edited = await telegram.editRichMessage(chatId, user.dashboard_message_id, html, keyboard);
    if (edited) return;
  }
  if (user.dashboard_message_id) await telegram.deleteMessage(chatId, user.dashboard_message_id);
  const messageId = await telegram.sendRichMessage(chatId, html, keyboard);
  await setDashboardMessage(env.DB, user.user_key, messageId, "text");
}

async function showPanelText(
  env: Env,
  telegram: TelegramPort,
  chatId: number,
  user: UserRecord,
  text: string,
  keyboard: InlineKeyboardMarkup,
): Promise<void> {
  await showPanelHtml(env, telegram, chatId, user, text.replace(/\n/g, "<br>"), keyboard);
}

function dashboardRichHtml(data: Awaited<ReturnType<typeof dashboardData>>, notice?: string): string {
  const total = data.totals.cdc + data.totals.supermarket + data.totals.energy;
  const trancheNames = [...new Set(data.rows.map((row) => row.label))];
  const trancheRows = trancheNames.map((label) => `<li>${escapeHtml(label)}</li>`).join("");
  const noticeHtml = notice ? `<p>${notice.replace(/\n/g, "<br>")}</p>` : "";
  return [
    "<h2>🏦 YOUR CDC BANK</h2>",
    "<i>Your private voucher wallet.</i>",
    "<table bordered striped><caption>Balances</caption>",
    "<tr><th>Voucher type</th><th align=\"right\">Balance</th></tr>",
    `<tr><td>CDC / Heartland</td><td align="right">$${data.totals.cdc}</td></tr>`,
    `<tr><td>Supermarket</td><td align="right">$${data.totals.supermarket}</td></tr>`,
    `<tr><td>Energy</td><td align="right">$${data.totals.energy}</td></tr>`,
    `<tr><th>Total</th><th align="right">$${total}</th></tr>`,
    "</table>",
    ...(trancheRows ? ["<h3>Your voucher tranches</h3>", `<ul>${trancheRows}</ul>`] : []),
    noticeHtml,
  ].join("\n");
}

export async function showDashboard(
  env: Env,
  telegram: TelegramPort,
  chatId: number,
  userKey: string,
  notice?: string,
): Promise<void> {
  const user = await ensureUser(env.DB, userKey);
  const data = await dashboardData(env.DB, userKey);
  if (data.sourceCount === 0) {
    await showPanelText(env, telegram, chatId, user, ONBOARDING_TEXT, await onboardingKeyboard(env, userKey));
    return;
  }
  const keyboard = await homeKeyboard(env, userKey);
  await showPanelHtml(env, telegram, chatId, user, dashboardRichHtml(data, notice), keyboard);
}

async function showPanel(
  env: Env,
  telegram: TelegramPort,
  chatId: number,
  userKey: string,
  text: string,
  keyboard: InlineKeyboardMarkup,
): Promise<void> {
  const user = await ensureUser(env.DB, userKey);
  await showPanelText(env, telegram, chatId, user, text.slice(0, 4_000), keyboard);
}

async function showPanelPhoto(
  env: Env,
  telegram: TelegramPort,
  chatId: number,
  userKey: string,
  png: Uint8Array,
  caption: string,
  keyboard: InlineKeyboardMarkup,
  filename = "voucher-wallet.png",
): Promise<void> {
  const user = await ensureUser(env.DB, userKey);
  if (user.dashboard_message_id && user.dashboard_kind === "photo") {
    const edited = await telegram.editPhoto(chatId, user.dashboard_message_id, png, caption.slice(0, 1_024), keyboard);
    if (edited) return;
  }
  if (user.dashboard_message_id) await telegram.deleteMessage(chatId, user.dashboard_message_id);
  const messageId = await telegram.sendPhoto(chatId, png, caption.slice(0, 1_024), keyboard, filename);
  await setDashboardMessage(env.DB, userKey, messageId, "photo");
}

async function resetDashboardPanel(
  env: Env,
  telegram: TelegramPort,
  chatId: number,
  userKey: string,
): Promise<void> {
  const user = await ensureUser(env.DB, userKey);
  if (user.dashboard_message_id) await telegram.deleteMessage(chatId, user.dashboard_message_id);
  await refreshAllSources(env, userKey);
  const data = await dashboardData(env.DB, userKey);
  const text = data.sourceCount === 0 ? ONBOARDING_TEXT : dashboardRichHtml(data);
  const keyboard = data.sourceCount === 0
    ? await onboardingKeyboard(env, userKey)
    : await homeKeyboard(env, userKey);
  const messageId = await telegram.sendRichMessage(chatId, text.includes("<table") ? text : text.replace(/\n/g, "<br>"), keyboard);
  await setDashboardMessage(env.DB, userKey, messageId, "text");
}

async function decryptGroupId(env: Env, userKey: string, source: SourceRecord): Promise<string> {
  return open(
    env.MASTER_ENCRYPTION_KEY,
    source.encrypted_group_id,
    `${userKey}:${source.id}:group`,
  );
}

async function refreshSource(env: Env, userKey: string, source: SourceRecord): Promise<SourceSnapshot> {
  const groupId = await decryptGroupId(env, userKey, source);
  const group = await fetchVoucherGroup(groupId);
  const label = campaignName(group);
  const snapshot = snapshotVoucherGroup(source.id, label, groupId, group);
  await updateSourceSnapshot(env.DB, source, snapshot);
  return snapshot;
}

async function refreshAllSources(env: Env, userKey: string): Promise<{ refreshed: number; failed: number }> {
  const sources = await listSources(env.DB, userKey);
  let refreshed = 0;
  let failed = 0;
  for (const source of sources) {
    try {
      await refreshSource(env, userKey, source);
      refreshed += 1;
    } catch (error) {
      failed += 1;
      console.error("source_refresh_failed", { source_id: source.id, reason: error instanceof Error ? error.message : "unknown" });
    }
  }
  return { refreshed, failed };
}

async function startAddFlow(env: Env, telegram: TelegramPort, chatId: number, userKey: string): Promise<void> {
  await setFlowState(env.DB, userKey, "await_voucher");
  const keyboard: InlineKeyboardMarkup = {
    inline_keyboard: [[await button(env, userKey, "Cancel", "h")]],
  };
  await showPanel(
    env, telegram, chatId, userKey,
    [
      "<h2>Add a voucher</h2>",
      "Paste your private voucher link here.",
      "",
      "🔒 <b>Keep it secret.</b> We’ll delete it after receipt and store it securely.",
    ].join("\n"),
    keyboard,
  );
}

async function addVoucherFromMessage(
  env: Env,
  telegram: TelegramPort,
  message: TelegramMessage,
  userKey: string,
): Promise<void> {
  const chatId = message.chat.id;
  const raw = String(message.text || "").trim();
  const deleted = await telegram.deleteMessage(chatId, message.message_id);
  if (!deleted) {
    await setFlowState(env.DB, userKey, "idle");
    await showPanel(
      env, telegram, chatId, userKey,
      "<b>Voucher not saved.</b> I couldn’t remove that private link from this chat. Delete it manually, then tap <b>Add voucher</b> and try again.",
      await homeKeyboard(env, userKey),
    );
    return;
  }
  const groupId = extractGroupId(raw);
  if (!groupId) {
    await showPanel(env, telegram, chatId, userKey, "That wasn’t a valid RedeemSG voucher link. Nothing was saved.", {
      inline_keyboard: [[await button(env, userKey, "Try again", "add"), await button(env, userKey, "Dashboard", "h")]],
    });
    return;
  }
  await telegram.sendChatAction(chatId, "typing");
  const fingerprint = await fingerprintGroup(env.MASTER_ENCRYPTION_KEY, groupId);
  const duplicate = await sourceByFingerprint(env.DB, userKey, fingerprint);
  if (duplicate) {
    let balanceText = "";
    try {
      await refreshSource(env, userKey, duplicate);
      const balances = await balancesForSource(env.DB, userKey, duplicate.id);
      const total = balances.reduce((sum, balance) => sum + balance.available, 0);
      balanceText = ` Its current balance is <b>$${total}</b>.`;
    } catch {
      balanceText = " It is still safely stored in your wallet.";
    }
    await setFlowState(env.DB, userKey, "idle");
    await showDashboard(env, telegram, chatId, userKey, `<b>Already in your CDC Bank</b>\n${escapeHtml(duplicate.label)}${balanceText}`);
    return;
  }
  try {
    const group = await fetchVoucherGroup(groupId);
    const label = campaignName(group);
    const sourceId = crypto.randomUUID();
    const normalizedUrl = normalizeVoucherUrl(raw, groupId);
    const encryptedUrl = await seal(
      env.MASTER_ENCRYPTION_KEY,
      normalizedUrl,
      `${userKey}:${sourceId}:url`,
    );
    const encryptedGroupId = await seal(
      env.MASTER_ENCRYPTION_KEY,
      groupId,
      `${userKey}:${sourceId}:group`,
    );
    const snapshot = snapshotVoucherGroup(sourceId, label, groupId, group);
    const source = await insertSource(env.DB, {
      id: sourceId,
      userKey,
      fingerprint,
      encryptedUrl,
      encryptedGroupId,
      label,
      campaignName: snapshot.campaignName,
      expiryDate: snapshot.expiryDate,
    });
    try {
      await updateSourceSnapshot(env.DB, source, snapshot);
    } catch (error) {
      await deleteSource(env.DB, userKey, sourceId);
      throw error;
    }
    await setFlowState(env.DB, userKey, "idle");
    const total = snapshot.balances.reduce((sum, balance) => sum + balance.available, 0);
    const balanceLines = snapshot.balances.map(
      (balance) => `• ${CATEGORY_LABEL[balance.category]}: <b>$${balance.available}</b>`,
    );
    await showDashboard(
      env,
      telegram,
      chatId,
      userKey,
      [
        "✅ <b>Added to your CDC Bank</b>",
        escapeHtml(label),
        ...balanceLines,
        `Total added: <b>$${total}</b>`,
      ].join("\n"),
    );
  } catch (error) {
    await setFlowState(env.DB, userKey, "idle");
    console.error("voucher_add_failed", error instanceof Error ? error.message : "unknown");
    await showPanel(
      env, telegram, chatId, userKey,
      "I couldn’t read that voucher. The private link was removed and nothing was saved. Check that the voucher is active, then try again.",
      await homeKeyboard(env, userKey),
    );
  }
}

async function showVoucherList(env: Env, telegram: TelegramPort, chatId: number, userKey: string): Promise<void> {
  const sources = await listSources(env.DB, userKey);
  if (!sources.length) {
    await showPanel(env, telegram, chatId, userKey, "You haven’t added any vouchers yet.", await onboardingKeyboard(env, userKey));
    return;
  }
  const rows: string[] = [];
  const keyboard: InlineButton[][] = [];
  for (const source of sources) {
    const balances = await balancesForSource(env.DB, userKey, source.id);
    const total = balances.reduce((sum, balance) => sum + balance.available, 0);
    rows.push(`<tr><td>${escapeHtml(source.label)}</td><td align="right">$${total}</td></tr>`);
    keyboard.push([await button(env, userKey, shortLabel(source.label, 28), `src:${source.id}`)]);
  }
  keyboard.push([await button(env, userKey, "＋ Add", "add"), await button(env, userKey, "← Dashboard", "h")]);
  await showPanelHtml(
    env,
    telegram,
    chatId,
    await ensureUser(env.DB, userKey),
    `<h2>My vouchers</h2><table bordered striped><tr><th>Voucher</th><th align="right">Balance</th></tr>${rows.join("")}</table>`,
    { inline_keyboard: keyboard.slice(0, 90) },
  );
}

async function showSourceDetails(
  env: Env,
  telegram: TelegramPort,
  chatId: number,
  userKey: string,
  sourceId: string,
): Promise<void> {
  const source = await sourceById(env.DB, userKey, sourceId);
  if (!source) {
    await showPanel(env, telegram, chatId, userKey, "That voucher is no longer in your wallet.", await homeKeyboard(env, userKey));
    return;
  }
  const balances = await balancesForSource(env.DB, userKey, sourceId);
  const balanceRows = balances.map(
    (balance) => `<tr><td>${CATEGORY_LABEL[balance.category]}</td><td align="right">$${balance.available}</td></tr>`,
  ).join("");
  const keyboard: InlineKeyboardMarkup = {
    inline_keyboard: [
      [
        await button(env, userKey, "↻ Refresh", `rfs:${sourceId}`),
        await button(env, userKey, "🗑 Remove", `rmc:${sourceId}`),
      ],
      [await button(env, userKey, "← My vouchers", "list")],
    ],
  };
  await showPanelHtml(
    env,
    telegram,
    chatId,
    await ensureUser(env.DB, userKey),
    `<h2>${escapeHtml(source.label)}</h2><table bordered striped><tr><th>Voucher type</th><th align="right">Balance</th></tr>${balanceRows}</table><i>🔒 Private link encrypted.</i>`,
    keyboard,
  );
}

async function showQrCategories(env: Env, telegram: TelegramPort, chatId: number, userKey: string): Promise<void> {
  const keyboard: InlineKeyboardMarkup = {
    inline_keyboard: [
      [await button(env, userKey, "CDC / Heartland", "cat:cdc")],
      [await button(env, userKey, "Supermarket", "cat:supermarket")],
      [await button(env, userKey, "Energy", "cat:energy")],
      [await button(env, userKey, "Back", "h")],
    ],
  };
  await showPanel(env, telegram, chatId, userKey, "<h2>Create a QR</h2>\nChoose a voucher type:", keyboard);
}

function isCategory(value: string): value is Category {
  return value === "cdc" || value === "supermarket" || value === "energy";
}

async function askAmount(
  env: Env,
  telegram: TelegramPort,
  chatId: number,
  userKey: string,
  category: Category,
): Promise<void> {
  await setFlowState(env.DB, userKey, "await_amount", category);
  const amountButtons: InlineButton[] = [];
  for (const amount of QUICK_AMOUNTS.slice(0, 6)) {
    amountButtons.push(await button(env, userKey, `$${amount}`, `amt:${category}:${amount}`));
  }
  const keyboard: InlineKeyboardMarkup = {
    inline_keyboard: [
      amountButtons.slice(0, 3),
      amountButtons.slice(3, 6),
      [await button(env, userKey, "← Voucher types", "qr")],
    ],
  };
  await showPanel(
    env, telegram, chatId, userKey,
    `<h2>${CATEGORY_LABEL[category]}</h2>\nChoose an amount or <b>type one</b>:`,
    keyboard,
  );
}

async function loadLiveSnapshots(env: Env, userKey: string): Promise<SourceSnapshot[]> {
  const sources = await listSources(env.DB, userKey);
  const snapshots: SourceSnapshot[] = [];
  for (const source of sources) {
    try {
      snapshots.push(await refreshSource(env, userKey, source));
    } catch (error) {
      console.error("qr_source_refresh_failed", { source_id: source.id, reason: error instanceof Error ? error.message : "unknown" });
    }
  }
  return snapshots;
}

async function generateQr(
  env: Env,
  telegram: TelegramPort,
  chatId: number,
  userKey: string,
  category: Category,
  amount: number,
): Promise<void> {
  const snapshots = await loadLiveSnapshots(env, userKey);
  const vouchers = snapshots.flatMap((snapshot) => snapshot.vouchers).filter((voucher) => voucher.category === category);
  const plan = selectPaymentPlan(vouchers, amount);
  if (!plan) {
    await showPanel(
      env, telegram, chatId, userKey,
      `There isn’t enough unused ${escapeHtml(CATEGORY_LABEL[category])} value to create this QR yet.`,
      { inline_keyboard: [[await button(env, userKey, "Choose another amount", `cat:${category}`)]] },
    );
    return;
  }

  const steps: StoredQrStep[] = [];
  for (const selection of plan.selections) {
    const payload = await qrPayloadForSelection(snapshots, selection);
    if (payload.length > 500) {
      await showPanel(env, telegram, chatId, userKey, "That QR would be too dense. Try a smaller amount.", {
        inline_keyboard: [[await button(env, userKey, "Choose another amount", `cat:${category}`)]],
      });
      return;
    }
    steps.push({
      payload,
      amount: selection.selectedAmount,
      tranche: selection.vouchers[0]?.sourceLabel || "Voucher tranche",
    });
  }
  await showQrCodes(env, telegram, chatId, userKey, steps, amount - plan.selectedAmount);
}

async function qrPayloadForSelection(snapshots: SourceSnapshot[], selection: SelectionResult): Promise<string> {
  const first = selection.vouchers[0];
  if (!first) throw new Error("QR selection was unexpectedly empty");
  if (first.aliasEnabled) {
    if (selection.vouchers.some((voucher) => voucher.sourceId !== first.sourceId)) {
      throw new Error("Alias QR selection crossed voucher sources");
    }
    const snapshot = snapshots.find((item) => item.sourceId === first.sourceId);
    if (!snapshot) throw new Error("QR source could not be loaded");
    return createAliasPayload(snapshot, selection.vouchers);
  }
  return `${first.qrPrefix}:${selection.vouchers.map((voucher) => voucher.id).join(",")}`;
}

async function showQrCodes(
  env: Env,
  telegram: TelegramPort,
  chatId: number,
  userKey: string,
  steps: StoredQrStep[],
  topUpAmount: number,
): Promise<void> {
  if (!steps.length) throw new Error("QR plan has no steps");
  const user = await ensureUser(env.DB, userKey);
  if (user.dashboard_message_id) await telegram.deleteMessage(chatId, user.dashboard_message_id);
  await telegram.sendChatAction(chatId, "upload_photo");
  const messageIds: number[] = [];
  for (const [index, step] of steps.entries()) {
    const isLast = index === steps.length - 1;
    const keyboard = isLast
      ? {
        inline_keyboard: [
          [await button(env, userKey, "New QR", "qr"), await button(env, userKey, "Dashboard", "h")],
          [await button(env, userKey, "↻ Refresh balances", "bal")],
        ],
      }
      : undefined;
    messageIds.push(await telegram.sendPhoto(
      chatId,
      qrPayloadToPng(step.payload),
      `<b>$${step.amount}</b>\n${escapeHtml(step.tranche)}`,
      keyboard,
      "voucher-qr.png",
    ));
  }
  const dashboardMessageId = messageIds[messageIds.length - 1];
  if (dashboardMessageId === undefined) throw new Error("QR message id was unexpectedly missing");
  await setDashboardMessage(env.DB, userKey, dashboardMessageId, "photo");
  const stored = await seal(
    env.MASTER_ENCRYPTION_KEY,
    JSON.stringify({ messageIds } satisfies StoredQrMessages),
    `${userKey}:qr-messages`,
  );
  await setFlowState(env.DB, userKey, "qr_messages", stored);
  if (topUpAmount > 0) {
    await telegram.sendMessage(chatId, `Please top up <b>$${topUpAmount}</b> with your own cash.`);
  }
}

async function clearQrMessages(env: Env, telegram: TelegramPort, chatId: number, userKey: string): Promise<void> {
  const user = await ensureUser(env.DB, userKey);
  if (user.flow_state !== "qr_messages" || !user.flow_payload) return;
  try {
    const stored = JSON.parse(await open(env.MASTER_ENCRYPTION_KEY, user.flow_payload, `${userKey}:qr-messages`)) as StoredQrMessages;
    if (!Array.isArray(stored.messageIds)) throw new Error("QR message list is malformed");
    for (const messageId of new Set(stored.messageIds)) {
      if (Number.isSafeInteger(messageId)) await telegram.deleteMessage(chatId, messageId);
    }
  } finally {
    await setFlowState(env.DB, userKey, "idle");
  }
}

async function handleMessage(env: Env, telegram: TelegramPort, message: TelegramMessage): Promise<void> {
  const chatId = message.chat.id;
  if (message.chat.type !== "private" || !message.from) {
    await telegram.sendMessage(chatId, "For your privacy, voucher management is available only in a private chat with this bot.");
    return;
  }
  const userKey = await deriveUserKey(env.MASTER_ENCRYPTION_KEY, message.from.id);
  const user = await ensureUser(env.DB, userKey);
  const text = String(message.text || "").trim();
  const command = text.split(/\s+/)[0]?.toLowerCase().replace(/@[^\s]+$/, "") || "";
  if (command === "/start" || command === "/help" || command === "/dashboard") {
    try {
      await telegram.setCommands(BOT_COMMANDS);
    } catch (error) {
      console.error("command_registration_failed", error instanceof Error ? error.message : "unknown");
    }
    await clearQrMessages(env, telegram, chatId, userKey);
    await setFlowState(env.DB, userKey, "idle");
    await resetDashboardPanel(env, telegram, chatId, userKey);
    return;
  }
  const commandCategory = command === "/cdc" ? "cdc" : command === "/supermarket" ? "supermarket" : command === "/energy" ? "energy" : null;
  if (commandCategory) {
    await clearQrMessages(env, telegram, chatId, userKey);
    await telegram.deleteMessage(chatId, message.message_id);
    const amountFromCommand = parseAmount(text.split(/\s+/)[1] || "");
    if (amountFromCommand) {
      await generateQr(env, telegram, chatId, userKey, commandCategory, amountFromCommand);
    } else {
      await askAmount(env, telegram, chatId, userKey, commandCategory);
    }
    return;
  }
  if (user.flow_state === "await_voucher") {
    await addVoucherFromMessage(env, telegram, message, userKey);
    return;
  }
  if (extractGroupId(text)) {
    const removed = await telegram.deleteMessage(chatId, message.message_id);
    const response = removed
      ? "For your privacy, I removed that voucher link. Tap <b>Add voucher</b>, then send it again so I can save it securely."
      : "I recognised a private voucher link but couldn’t remove it. Delete that message manually, then tap <b>Add voucher</b> and try again.";
    await showPanel(env, telegram, chatId, userKey, response, {
      inline_keyboard: [[await button(env, userKey, "Add voucher", "add")]],
    });
    return;
  }
  const pendingCategory = user.flow_payload;
  if (user.flow_state === "await_amount" && pendingCategory && isCategory(pendingCategory)) {
    const amount = parseAmount(text);
    await telegram.deleteMessage(chatId, message.message_id);
    if (!amount) {
      await showPanel(env, telegram, chatId, userKey, "Enter a whole-dollar amount, such as <b>20</b>.", {
        inline_keyboard: [[await button(env, userKey, "Back to amounts", `cat:${pendingCategory}`)]],
      });
      return;
    }
    await generateQr(env, telegram, chatId, userKey, pendingCategory, amount);
    return;
  }
  await showDashboard(env, telegram, chatId, userKey);
}

async function handleCallback(
  env: Env,
  telegram: TelegramPort,
  query: TelegramCallbackQuery,
): Promise<void> {
  const message = query.message;
  if (!message || message.chat.type !== "private") {
    await telegram.answerCallback(query.id, "Open this bot in a private chat.", true);
    return;
  }
  const userKey = await deriveUserKey(env.MASTER_ENCRYPTION_KEY, query.from.id);
  await ensureUser(env.DB, userKey);
  const payload = await verifyCallback(env.MASTER_ENCRYPTION_KEY, userKey, String(query.data || ""));
  if (!payload) {
    await telegram.answerCallback(query.id, "This button has expired. Open your dashboard again.", true);
    return;
  }
  const chatId = message.chat.id;
  const [action, first, second] = payload.split(":");
  await telegram.answerCallback(query.id, action === "bal" ? "Refreshing balances…" : action === "h" ? "Opening dashboard…" : "Working…");
  if (action === "h") {
    await clearQrMessages(env, telegram, chatId, userKey);
    await setFlowState(env.DB, userKey, "idle");
    await showDashboard(env, telegram, chatId, userKey);
  } else if (action === "add") {
    await startAddFlow(env, telegram, chatId, userKey);
  } else if (action === "bal") {
    await clearQrMessages(env, telegram, chatId, userKey);
    const result = await refreshAllSources(env, userKey);
    await showDashboard(env, telegram, chatId, userKey, result.failed
      ? `${result.refreshed} vouchers refreshed. ${result.failed} could not be reached right now.`
      : result.refreshed ? `${result.refreshed} voucher${result.refreshed === 1 ? "" : "s"} refreshed.` : undefined);
  } else if (action === "list") {
    await showVoucherList(env, telegram, chatId, userKey);
  } else if (action === "qr") {
    await clearQrMessages(env, telegram, chatId, userKey);
    await showQrCategories(env, telegram, chatId, userKey);
  } else if (action === "cat" && first && isCategory(first)) {
    await askAmount(env, telegram, chatId, userKey, first);
  } else if (action === "custom" && first && isCategory(first)) {
    await setFlowState(env.DB, userKey, "await_amount", first);
    await showPanel(env, telegram, chatId, userKey, `<b>${CATEGORY_LABEL[first]}</b>\n\nType the whole-dollar amount you want to spend.`, {
      inline_keyboard: [[await button(env, userKey, "Back to amounts", `cat:${first}`)]],
    });
  } else if (action === "amt" && first && isCategory(first)) {
    const amount = parseAmount(second || "");
    if (amount) await generateQr(env, telegram, chatId, userKey, first, amount);
  } else if (action === "src" && first) {
    await showSourceDetails(env, telegram, chatId, userKey, first);
  } else if (action === "rfs" && first) {
    const source = await sourceById(env.DB, userKey, first);
    if (source) await refreshSource(env, userKey, source);
    await showSourceDetails(env, telegram, chatId, userKey, first);
  } else if (action === "rmc" && first) {
    const source = await sourceById(env.DB, userKey, first);
    if (!source) return;
    await showPanel(
      env, telegram, chatId, userKey,
      `Remove <b>${escapeHtml(source.label)}</b> from your wallet?`,
      {
        inline_keyboard: [[
          await button(env, userKey, "Yes, remove", `rm:${first}`),
          await button(env, userKey, "Cancel", `src:${first}`),
        ]],
      },
    );
  } else if (action === "rm" && first) {
    const source = await sourceById(env.DB, userKey, first);
    const removed = await deleteSource(env.DB, userKey, first);
    await showDashboard(env, telegram, chatId, userKey, removed ? `<b>${escapeHtml(source?.label || "Voucher")}</b> removed.` : undefined);
  }
}

export async function handleTelegramUpdate(
  env: Env,
  update: TelegramUpdate,
  telegram: TelegramPort = new TelegramClient(env.TELEGRAM_BOT_TOKEN),
): Promise<void> {
  if (update.callback_query) {
    await handleCallback(env, telegram, update.callback_query);
  } else if (update.message) {
    await handleMessage(env, telegram, update.message);
  }
}
