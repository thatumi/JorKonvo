import { createHash } from 'node:crypto'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * The homeserver, its media repo and the LiveKit SFU are all user-configured
 * at runtime (any host), so connect-/img-/media-src can't be pinned to a
 * fixed origin - and room widgets (Etherpad, Jitsi, dashboards) iframe
 * genuinely arbitrary https URLs, so frame-src can't either. What still gets
 * locked down: `script-src 'self'` (+ wasm for rust-crypto / RNNoise),
 * `object-src 'none'`, `base-uri`, no plugins, https-only framed content
 * (RichEmbed is separately restricted to a provider allowlist in code).
 */
const SHARED_CSP = [
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  "frame-src 'self' https:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
]

// sha256 CSP hashes for every inline <script> (no src) in the document, so
// `script-src` can stay free of 'unsafe-inline'. index.html carries one such
// script - the pre-paint theme init - and without its hash here the CSP that
// round 17 added silently blocks it in production and in the Tauri shell
// (dev's DEV_CSP has 'unsafe-inline' for Vite's HMR client, which masked it).
function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = []
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const body = m[1]
    if (!body.trim()) continue
    hashes.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`)
  }
  return hashes
}

function buildCsp(html: string, isServe: boolean): string {
  const scriptSrc = isServe
    ? // Dev needs Vite's HMR client (inline script + eval).
      "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' 'unsafe-inline'"
    : ["script-src 'self' 'wasm-unsafe-eval'", ...inlineScriptHashes(html)].join(' ')
  return [
    "default-src 'self'",
    scriptSrc,
    isServe
      ? "connect-src 'self' https: wss: ws: blob: data:"
      : "connect-src 'self' https: wss: blob: data:",
    ...SHARED_CSP,
  ].join('; ')
}

function cspPlugin(): Plugin {
  return {
    name: 'jorkonvo-csp-meta',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const csp = buildCsp(html, !!ctx.server)
        // After <meta charset> so the charset declaration stays within the
        // first 1024 bytes of the document as the HTML spec requires.
        return html.replace(
          '<meta charset="UTF-8" />',
          `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
        )
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [cspPlugin(), react(), tailwindcss()],
  server: {
    // Electron/Capacitor shells load from a fixed origin; keep dev server predictable.
    port: 5173,
    strictPort: true,
    // Listen on all interfaces (not just localhost) so it's reachable over Tailscale/LAN.
    host: true,
  },
  base: './',
})
