import { ReceiptType } from "@jorkonvo/matrix-core";

/**
 * Private read receipts (m.read.private, spec-standard) - a receipt of this
 * type still tells the SERVER you've read up to an event (so unread counts/
 * notifications work normally for you), but the server never broadcasts it
 * to other room members the way a normal m.read receipt is. A per-device
 * preference, same as auto-away in idlePresence.ts - simplest honest
 * option, no need to invent an account-data schema for it.
 */

const KEY = "jorkonvo-private-read-receipts";

export function isPrivateReadReceiptsEnabled(): boolean {
  return localStorage.getItem(KEY) === "1";
}

export function setPrivateReadReceiptsEnabled(enabled: boolean): void {
  localStorage.setItem(KEY, enabled ? "1" : "0");
}

export function currentReceiptType(): ReceiptType {
  return isPrivateReadReceiptsEnabled() ? ReceiptType.ReadPrivate : ReceiptType.Read;
}
