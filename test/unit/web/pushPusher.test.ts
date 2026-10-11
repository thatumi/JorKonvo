import { describe, expect, it } from "vitest";
import {
  buildPusher,
  buildPusherDeletion,
  hasMatchingPusher,
  PUSH_APP_IDS,
  pushNotifyUrl,
  staleCasePushkeys,
} from "../../../apps/web/src/lib/push/pusher";

// Sygnal (services/sygnal) picks the pushkin by app_id and is strict about
// the rest of the shape; these pin what each platform registers.

const opts = { lang: "hu", deviceDisplayName: "test device", notifyUrl: "https://push.example/_matrix/push/v1/notify" };

describe("pushNotifyUrl", () => {
  it("appends the path Synapse requires, tolerating a trailing slash", () => {
    expect(pushNotifyUrl("https://push.szabotar.dev/")).toBe("https://push.szabotar.dev/_matrix/push/v1/notify");
    expect(pushNotifyUrl("https://push.szabotar.dev")).toBe("https://push.szabotar.dev/_matrix/push/v1/notify");
  });
});

describe("buildPusher", () => {
  it("app ids match the Sygnal config", () => {
    expect(PUSH_APP_IDS).toEqual({
      ios: "dev.szabotar.jorkonvo.ios",
      android: "dev.szabotar.jorkonvo.android",
      web: "dev.szabotar.jorkonvo.web",
    });
  });

  it("web stays on the full format (its service worker can't resolve anything)", () => {
    const web = buildPusher("web", { endpoint: "https://fcm.example/x", p256dh: "P", auth: "A" }, opts);
    expect(web.data).not.toHaveProperty("format");
  });

  it("iOS: event_id_only + a visible, mutable alert for the Notification Service Extension", () => {
    const p = buildPusher("ios", "a1b2c3", { ...opts, userId: "@ava:example.org" });
    expect(p).toMatchObject({ app_id: "dev.szabotar.jorkonvo.ios", kind: "http", pushkey: "a1b2c3", append: true });
    expect(p.data).toEqual({
      url: opts.notifyUrl,
      format: "event_id_only",
      default_payload: {
        aps: { alert: { "loc-key": "JK_NEW_MESSAGE" }, "mutable-content": 1, sound: "default" },
        jk_uid: "@ava:example.org",
      },
    });
  });

  it("iOS: Capacitor's uppercase hex token is normalised to lowercase", () => {
    expect(buildPusher("ios", "A1B2C3", opts).pushkey).toBe("a1b2c3");
  });

  it("Android: event_id_only (resolved on the device) + which account it's for", () => {
    const p = buildPusher("android", "fcm-token", { ...opts, userId: "@ava:example.org" });
    expect(p).toMatchObject({ app_id: "dev.szabotar.jorkonvo.android", pushkey: "fcm-token" });
    expect(p.data).toEqual({
      url: opts.notifyUrl,
      format: "event_id_only",
      default_payload: { jk_uid: "@ava:example.org" },
    });
  });

  it("Web: pushkey is the p256dh key, endpoint + auth in data (Sygnal's webpush contract)", () => {
    const p = buildPusher("web", { endpoint: "https://fcm.example/x", p256dh: "P256", auth: "AUTH" }, opts);
    expect(p.pushkey).toBe("P256");
    expect(p.data).toEqual({ url: opts.notifyUrl, endpoint: "https://fcm.example/x", auth: "AUTH", events_only: true });
  });

  it("rejects a token of the wrong kind", () => {
    expect(() => buildPusher("web", "just-a-string", opts)).toThrow();
    expect(() => buildPusher("ios", { endpoint: "e", p256dh: "p", auth: "a" }, opts)).toThrow();
  });

  it("caps the device display name", () => {
    expect(buildPusher("android", "t", { ...opts, deviceDisplayName: "x".repeat(200) }).device_display_name).toHaveLength(90);
  });
});

describe("buildPusherDeletion", () => {
  it("is kind:null for the same app id + pushkey", () => {
    const d = buildPusherDeletion("android", "fcm-token", "en");
    expect(d).toMatchObject({ app_id: "dev.szabotar.jorkonvo.android", pushkey: "fcm-token", kind: null });
  });

  it("iOS: lowercases the raw token like buildPusher, so it hits the registered pusher", () => {
    expect(buildPusherDeletion("ios", "A1B2C3", "en").pushkey).toBe(buildPusher("ios", "A1B2C3", opts).pushkey);
  });
});

describe("hasMatchingPusher", () => {
  const wanted = buildPusher("ios", "tok", opts);

  it("matches the same key and data regardless of key order", () => {
    const reordered = Object.fromEntries(Object.entries(wanted.data).reverse());
    const server = [{ app_id: wanted.app_id, pushkey: "tok", data: reordered }];
    expect(hasMatchingPusher(server, wanted)).toBe(true);
  });

  it("does not trust an older pusher (full format, other gateway, no sound)", () => {
    const base = { app_id: wanted.app_id, pushkey: "tok" };
    const phase1 = { url: opts.notifyUrl, default_payload: { aps: { sound: "default" } } };
    expect(hasMatchingPusher([{ ...base, data: phase1 }], wanted)).toBe(false);
    expect(hasMatchingPusher([{ ...base, data: { ...wanted.data, url: "https://old.example/_matrix/push/v1/notify" } }], wanted)).toBe(false);
    expect(hasMatchingPusher([{ ...base, data: { url: opts.notifyUrl } }], wanted)).toBe(false);
  });

  it("ignores other devices' pushers", () => {
    expect(hasMatchingPusher([{ app_id: wanted.app_id, pushkey: "other", data: wanted.data }], wanted)).toBe(false);
  });
});

describe("staleCasePushkeys", () => {
  const wanted = buildPusher("ios", "A1B2C3", opts);

  it("finds this device's pusher registered under an upper-case key by an older build", () => {
    const pushers = [
      { app_id: wanted.app_id, pushkey: "A1B2C3", data: {} },
      { app_id: wanted.app_id, pushkey: "a1b2c3", data: wanted.data },
      { app_id: wanted.app_id, pushkey: "OTHER", data: {} },
      { app_id: "io.element.elementx.ios.prod", pushkey: "a1B2c3", data: {} },
    ];
    expect(staleCasePushkeys(pushers, wanted)).toEqual(["A1B2C3"]);
  });

  it("is empty when only the exact pusher exists", () => {
    expect(staleCasePushkeys([{ app_id: wanted.app_id, pushkey: "a1b2c3" }], wanted)).toEqual([]);
  });
});
