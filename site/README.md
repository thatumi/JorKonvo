# site/ — JorKonvo marketing & download site

Plain static HTML/CSS/JS, no build step. Bilingual (EN default, HU toggle,
remembered in `localStorage`), dark/light theme toggle matching the app's own
design tokens (`apps/web/src/index.css`).

- `index.html` — landing page: hero, features, "what is Matrix", downloads.
- `privacy.html` — renders `store/privacy-policy.md` (EN+HU, both shown).
- `support.html` — contact + known-limits FAQ.
- `assets/style.css` — all styling, shared by all three pages.
- `assets/screenshot-{dark,light}.png` — real screenshots of the running
  0.1.3 Linux build (login screen), captured via CDP against a headless
  `xvfb-run` instance — not mockups.

## Local preview

```
cd site && python3 -m http.server 8921
```

## Deploy (live, 2026-10-11)

The owner bought `jorkonvo.com` and moved its DNS to deSEC (same pattern as
`szabotar.dev`: apex `A` record at 900s TTL kept current by
`/opt/stacks/ddns-updater`, `*` wildcard CNAME to the apex, NS switched at
Porkbun to `ns1.desec.io`/`ns2.desec.org`, DS record added for DNSSEC).

Running on kimle-server as `/opt/stacks/jorkonvo-site/` — **not** the
`Dockerfile`/`compose.yaml` in this directory (those are a self-contained
alternative, still valid, just unused in practice). The live deployment
instead mirrors `jorkonvo-web`'s own pattern: a bare `nginx:alpine` bind-mount
over this `site/` directory, published on `127.0.0.1:8182`:

```yaml
# /opt/stacks/jorkonvo-site/docker-compose.yml
services:
  jorkonvo-site:
    image: nginx:alpine
    volumes:
      - /home/thatumi/JorKonvo/site:/usr/share/nginx/html:ro
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro   # own copy, not this dir's
    ports:
      - "127.0.0.1:8182:8182"
```

Its `nginx.conf` additionally blocks `/Dockerfile`, `/compose.yaml`,
`/nginx.conf`, `/README.md` from being served (the bind mount is this whole
source dir, not a build output).

NPM proxy host: `jorkonvo.com` (+ `www.jorkonvo.com` via the wildcard) →
`127.0.0.1:8182`, Let's Encrypt cert issued and live.

**The app itself** now also serves at `app.jorkonvo.com` (same backend
container/port as `jorkonvo.szabotar.dev`, `127.0.0.1:8181` — no code or
container changes, just a second NPM proxy host). `jorkonvo.szabotar.dev`
was deliberately left alone rather than redirected, so existing bookmarks/
installed PWAs keep working. The in-app invite-link domain
(`apps/web/src/lib/inviteLinkHandler.ts`) still hardcodes
`jorkonvo.szabotar.dev` — intentionally not touched yet, since changing it
would need matching Android `assetlinks.json` / iOS
`apple-app-site-association` work for App/Universal Links. Old invite links
keep working either way since the app's own routing is client-side (no
server routes to break).

**Blocked on repo visibility:** every download button links to a Forgejo
release asset (`git.szabotar.dev/thatumi/JorKonvo/releases/download/...`).
Those links 404 for anyone without repo access until the JorKonvo repo is
made public (tracked as its own item in `.hub/status.json`).

**App Store listing URLs still need updating:** `store/app-store-listing.md`
has Support URL `https://jorkonvo.szabotar.dev/support.html` and Marketing
URL `https://jorkonvo.szabotar.dev` — both predate this site. Should become
`https://jorkonvo.com/support.html` and `https://jorkonvo.com`.

## Updating content for a new release

The download section (`index.html`, `#download`) hardcodes version numbers
and asset URLs per platform. Bump them by hand when cutting a new release -
there's no templating.
