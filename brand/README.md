# JorKonvo brand mark

- `jorkonvo-mark.svg` — transparent-background mark (chat bubble + 3-bar
  equalizer), used for favicons and anywhere the mark sits on its own
  background. Source for `apps/web/public/favicon.svg` and
  `site/assets/favicon.svg`.
- `jorkonvo-icon-square.svg` — opaque square variant (gradient fill,
  white badge), used for platform app icons where transparency isn't
  allowed (iOS/Android/Windows/Play Store). Render to a 1024x1024 PNG
  and feed it to the platform icon generators:

```bash
rsvg-convert -w 1024 -h 1024 jorkonvo-mark.svg -o /tmp/mark-1024.png
rsvg-convert -w 1024 -h 1024 jorkonvo-icon-square.svg -o /tmp/icon-1024.png

# Desktop (Tauri): regenerates apps/desktop/src-tauri/icons/*
cd apps/desktop && npx tauri icon /tmp/mark-1024.png
rm -rf src-tauri/icons/ios src-tauri/icons/android   # unused Tauri-mobile output

# Android + iOS (Capacitor): regenerates launcher icons + splash screens
cp /tmp/icon-1024.png apps/web/resources/icon.png
cd apps/web && npx @capacitor/assets generate --android --ios
```

Brand color: `#8b5cf6` (`--color-brand` in `site/assets/style.css`).
Gradient stops used throughout: `#a78bfa` → `#8b5cf6` → `#6d28d9`.
