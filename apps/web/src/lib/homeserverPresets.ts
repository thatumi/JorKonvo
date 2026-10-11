/**
 * Quick-pick list for the homeserver field on the login/register screen.
 * Purely a UI convenience - the free-text field next to the dropdown is
 * always the source of truth, so picking "Other" is a no-op and any value
 * (preset or hand-typed) works the same way for login/register/QR.
 */
export interface HomeserverPreset {
  readonly label: string;
  readonly url: string;
}

export const HOMESERVER_PRESETS: readonly HomeserverPreset[] = [
  { label: "matrix.org (public, open registration)", url: "https://matrix.org" },
  { label: "tchncs.de (public, open registration)", url: "https://matrix.tchncs.de" },
];

/** Sentinel for the dropdown's "type your own" option; never a real homeserver URL. */
export const CUSTOM_HOMESERVER_VALUE = "__custom__";

/** Which <option> should show as selected for a given free-typed URL. */
export function presetValueFor(homeserverUrl: string): string {
  const trimmed = homeserverUrl.trim();
  return HOMESERVER_PRESETS.find((p) => p.url === trimmed)?.url ?? CUSTOM_HOMESERVER_VALUE;
}
