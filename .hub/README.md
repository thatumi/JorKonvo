# .hub/ — Project HQ status

This folder feeds the cross-project dashboard at `~/jorhub/dashboard.html`
(published as a Claude artifact). **Any AI session or human working in this
repo should keep `status.json` current.**

## status.json fields

| field       | meaning |
|-------------|---------|
| `phase`     | short free text: where the project is (e.g. `"v0.2 in progress"`, `"pre-launch"`) |
| `health`    | one of: `active`, `attention`, `blocked`, `dormant`, `shipping` |
| `summary`   | 1-3 sentences on the current state |
| `updated`   | ISO date `YYYY-MM-DD` |
| `updatedBy` | who last touched this (e.g. `"Claude Code"`, `"Tamás"`) |
| `needs`     | list of `{ "what": str, "who": "human"|"ai"|"infra", "blocking": bool }` |
| `next`      | list of strings: the next concrete actions |
| `links`     | list of `{ "label": str, "url": str }` |

## screenshots/

Drop PNG/JPG files here (a UI screen, a chart, a terminal). The dashboard shows
the newest few, downscaled. Name them descriptively — the filename becomes the
caption.
