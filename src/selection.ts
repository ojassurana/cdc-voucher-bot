import type { Voucher } from "./types";

export const MAX_VOUCHERS_PER_QR = 15;
export const MAX_QR_CODES_PER_PAYMENT = 2;

export interface SelectionResult {
  requested: number;
  selectedAmount: number;
  exact: boolean;
  vouchers: Voucher[];
}

export interface PaymentPlan {
  requested: number;
  selectedAmount: number;
  exact: boolean;
  selections: SelectionResult[];
}

function selectionKey(voucher: Voucher): string {
  // Each QR belongs to one saved voucher tranche. This keeps split payments
  // explicit and never combines voucher groups into one code.
  return voucher.sourceId;
}

function better(candidate: Voucher[], current: Voucher[] | undefined): boolean {
  if (!current) return true;
  if (candidate.length !== current.length) return candidate.length < current.length;
  const left = candidate.map((voucher) => voucher.value).sort((a, b) => b - a).join(",");
  const right = current.map((voucher) => voucher.value).sort((a, b) => b - a).join(",");
  return left > right;
}

function optionsWithinGroup(vouchers: Voucher[], target: number, maxCount: number): Map<number, Voucher[]> {
  const sorted = vouchers
    .filter((voucher) => voucher.state === "unused" && voucher.value > 0)
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  const sums = new Map<number, Voucher[]>([[0, []]]);
  for (const voucher of sorted) {
    for (const [sum, picked] of [...sums.entries()]) {
      if (picked.length >= maxCount) continue;
      const next = sum + voucher.value;
      if (next > target) continue;
      const candidate = [...picked, voucher];
      if (better(candidate, sums.get(next))) sums.set(next, candidate);
    }
  }
  return sums;
}

function bestWithinGroup(vouchers: Voucher[], target: number, maxCount: number): SelectionResult | null {
  const sums = optionsWithinGroup(vouchers, target, maxCount);
  const selectedAmount = Math.max(...sums.keys());
  if (selectedAmount <= 0) return null;
  return { requested: target, selectedAmount, exact: selectedAmount === target, vouchers: sums.get(selectedAmount) || [] };
}

export function selectBestAtOrBelow(
  vouchers: Voucher[],
  target: number,
  maxCount = MAX_VOUCHERS_PER_QR,
): SelectionResult | null {
  const groups = new Map<string, Voucher[]>();
  for (const voucher of vouchers) {
    const key = selectionKey(voucher);
    const group = groups.get(key) || [];
    group.push(voucher);
    groups.set(key, group);
  }
  let best: SelectionResult | null = null;
  for (const group of groups.values()) {
    const candidate = bestWithinGroup(group, target, maxCount);
    if (!candidate) continue;
    if (
      !best ||
      candidate.selectedAmount > best.selectedAmount ||
      (candidate.selectedAmount === best.selectedAmount && candidate.vouchers.length < best.vouchers.length)
    ) {
      best = candidate;
    }
  }
  return best;
}

function atOrBelow(values: number[], target: number): number | null {
  let low = 0;
  let high = values.length - 1;
  let answer = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const value = values[middle];
    if (value === undefined) break;
    if (value <= target) {
      answer = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return answer >= 0 ? values[answer] ?? null : null;
}

function isBetterPlan(candidate: PaymentPlan, current: PaymentPlan | null): boolean {
  if (!current) return true;
  if (candidate.selectedAmount !== current.selectedAmount) return candidate.selectedAmount > current.selectedAmount;
  const candidateVouchers = candidate.selections.reduce((sum, selection) => sum + selection.vouchers.length, 0);
  const currentVouchers = current.selections.reduce((sum, selection) => sum + selection.vouchers.length, 0);
  if (candidateVouchers !== currentVouchers) return candidateVouchers < currentVouchers;
  return candidate.selections.length < current.selections.length;
}

export function selectPaymentPlan(vouchers: Voucher[], target: number): PaymentPlan | null {
  const groups = new Map<string, Voucher[]>();
  for (const voucher of vouchers) {
    const group = groups.get(selectionKey(voucher)) || [];
    group.push(voucher);
    groups.set(selectionKey(voucher), group);
  }
  const options = [...groups.values()].map((group) => optionsWithinGroup(group, target, MAX_VOUCHERS_PER_QR));
  let best: PaymentPlan | null = null;

  for (const sums of options) {
    const amount = Math.max(...sums.keys());
    if (amount <= 0) continue;
    const candidate: PaymentPlan = {
      requested: target,
      selectedAmount: amount,
      exact: amount === target,
      selections: [{ requested: target, selectedAmount: amount, exact: amount === target, vouchers: sums.get(amount) || [] }],
    };
    if (isBetterPlan(candidate, best)) best = candidate;
  }

  for (let left = 0; left < options.length; left += 1) {
    for (let right = left + 1; right < options.length; right += 1) {
      const leftSums = options[left];
      const rightSums = options[right];
      if (!leftSums || !rightSums) continue;
      const rightAmounts = [...rightSums.keys()].filter((amount) => amount > 0).sort((a, b) => a - b);
      for (const [leftAmount, leftVouchers] of leftSums) {
        if (leftAmount <= 0) continue;
        const rightAmount = atOrBelow(rightAmounts, target - leftAmount);
        if (!rightAmount) continue;
        const total = leftAmount + rightAmount;
        const candidate: PaymentPlan = {
          requested: target,
          selectedAmount: total,
          exact: total === target,
          selections: [
            { requested: target, selectedAmount: leftAmount, exact: leftAmount === target, vouchers: leftVouchers },
            { requested: target, selectedAmount: rightAmount, exact: rightAmount === target, vouchers: rightSums.get(rightAmount) || [] },
          ],
        };
        if (isBetterPlan(candidate, best)) best = candidate;
      }
    }
  }
  return best;
}

export function parseAmount(raw: string): number | null {
  const value = String(raw || "").trim().replace(/^\$/, "");
  if (!/^\d+$/.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 10_000 ? amount : null;
}

export function denominationText(vouchers: Voucher[]): string {
  const counts = new Map<number, number>();
  for (const voucher of vouchers) counts.set(voucher.value, (counts.get(voucher.value) || 0) + 1);
  return [...counts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([value, count]) => `$${value}×${count}`)
    .join(" · ");
}
