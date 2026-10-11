export * from "./types.js";
export * from "./session-storage.js";
export * from "./client.js";
export * from "./crypto.js";
export * from "./rooms.js";
export * from "./messages.js";
export * from "./room-admin.js";
export * from "./media.js";
export * from "./profile.js";
export * from "./threads.js";
export * from "./calls.js";
export * from "./groupCalls.js";
export * from "./verification.js";
export * from "./moderation.js";
export * from "./formatting.js";
export * from "./commands.js";
export * from "./notifications.js";
export * from "./search.js";
export * from "./voiceChannels.js";
export * from "./ignoredUsers.js";
export * from "./devices.js";
export * from "./accountDeletion.js";
export * from "./dataExport.js";
export * from "./inviteLinks.js";
export * from "./categories.js";
export * from "./roomProfile.js";
export * from "./auditLog.js";
export * from "./polls.js";
export * from "./voiceMessages.js";
export * from "./friends.js";
export * from "./roles.js";
export * from "./onboarding.js";
export * from "./watchTogether.js";
export * from "./unread.js";
export * from "./calendarEvents.js";
export * from "./joinRules.js";
export * from "./historyVisibility.js";
export * from "./userTimeout.js";
export * from "./roomUpgrade.js";
export * from "./channelAccess.js";
export * from "./guestAccess.js";
export * from "./registration.js";
export * from "./searchFilters.js";
export * from "./inbox.js";
export * from "./roomTags.js";
export * from "./stickers.js";
export * from "./location.js";
export * from "./slowmode.js";
export * from "./automod.js";
export * from "./widgets.js";
export * from "./forum.js";
// NOTE: qrLogin is deliberately NOT re-exported here. It (transitively)
// pulls in matrix-js-sdk's MSC4108 rendezvous classes, which statically
// import the ~7.8 MB matrix-sdk-crypto-wasm glue - keeping it out of this
// barrel keeps that glue off the app's main bundle / pre-auth login path.
// Import it from "@jorkonvo/matrix-core/qr" (dynamically) instead.
export type { QrLoginSecrets } from "./qrLogin.js";
export * from "./threepid.js";
export * from "./editHistory.js";
export * from "./policyLists.js";
export * from "./activity.js";
export * from "./reactionRoles.js";
export * from "./jumpToDate.js";
export * from "./timedMute.js";
export * from "./roomEmoji.js";
export * from "./personalEmoji.js";
export * from "./spaceTemplate.js";
export * from "./soundboard.js";
export * from "./spaceSettings.js";
export * from "./spaceLayout.js";
export * from "./clientSettings.js";
export * from "./superReactions.js";
export * from "./userCallPrefs.js";
export * from "./userNotes.js";
export * from "./channelStatus.js";
export * from "./channelContent.js";
export * from "./welcomeMessages.js";
export * from "./spacePrivacy.js";
export * from "./permissions.js";

// Re-export commonly used matrix-js-sdk types/values so consumers don't need
// a second dependency just for type annotations.
export type { MatrixClient, Room, MatrixEvent, RoomMember, Thread } from "matrix-js-sdk";
export {
  ClientEvent,
  Direction,
  EventStatus,
  EventType,
  MatrixEventEvent,
  MsgType,
  ReceiptType,
  RelationType,
  RoomEvent,
  RoomMemberEvent,
  SetPresence,
  SyncState,
  ThreadEvent,
} from "matrix-js-sdk";
