# JorKonvo — IARC content-rating questionnaire

Category: **Communication** (chat/social).

| Question | Answer | Why |
|---|---|---|
| Violence / sexual / profanity / drugs in the app's own content | No | The app ships no such content |
| **User-generated content** shared with other users | **Yes** | Chat, media, public rooms/spaces are user-created and can be unmoderated |
| Users can interact / communicate with each other | **Yes** | Core function |
| Shares user's location with other users | **Yes (optional)** | Location messages / live location (user-initiated) |
| Unrestricted internet access / browse web | Link previews and joined servers' content; no built-in browser | — |
| Digital purchases | No | — |
| Gambling | No | — |
| Targets children | No | Not directed at children |

Expected: rating reflecting unmoderated UGC ("Users Interact", "Shares
Location"; typically Teen). Play's UGC policy requires reporting + blocking:
JorKonvo has *Report message* (`packages/matrix-core/src/moderation.ts`) and
*Block/ignore user* (`ignoredUsers.ts`), plus room moderation tools — mention
these in the Console's UGC answers.
