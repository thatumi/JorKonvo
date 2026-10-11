import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// Code blocks always render on a dark background, so one fixed hljs theme is
// used in both the dark and light app themes.
import 'highlight.js/styles/github-dark.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { installAndroidScreenShareBridge } from './lib/androidScreenShare.ts'
import { installIosScreenShareBridge } from './lib/iosScreenShare.ts'
import { installIosLongPressContextMenu } from './lib/iosLongPressContextMenu.ts'
import { installDocumentScrollGuard } from './lib/documentScrollGuard.ts'

// Runs before anything can call getDisplayMedia: neither WebView implements
// it, so the native bridge must take its place before the app (and
// livekit-client's webrtc-adapter, which would otherwise shim it away at
// import time) gets there first. Each is a no-op on the other two platforms.
installAndroidScreenShareBridge()
installIosScreenShareBridge()

// WKWebView (iOS) never synthesizes a `contextmenu` DOM event from a
// long-press touch - every onContextMenu-wired row would be unreachable by
// touch there without this. No-op on web/Android, which get a real event.
installIosLongPressContextMenu()

// The shell never scrolls as a document; undo the scroll offset iOS can leave
// behind when the keyboard closes (see documentScrollGuard.ts).
installDocumentScrollGuard()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
