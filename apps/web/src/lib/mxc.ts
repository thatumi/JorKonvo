import type { MatrixClient } from "@jorkonvo/matrix-core";

/** Converts an mxc:// URI to an HTTP thumbnail URL, or null if unavailable. */
export function mxcToThumbnail(
  client: MatrixClient,
  mxcUrl: string | undefined,
  size = 40,
): string | null {
  if (!mxcUrl) return null;
  return client.mxcUrlToHttp(mxcUrl, size, size, "crop");
}

export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.replace(/^[#!@]/, "").split(/[\s-_]+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}
