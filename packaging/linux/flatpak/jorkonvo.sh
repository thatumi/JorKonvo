#!/bin/sh
# Flatpak already confines the app (bwrap: namespaces + seccomp), and Chromium's
# own sandbox cannot start inside it (no nested user namespaces, no setuid), so
# it is disabled here on purpose. Renderer isolation from the *host* is Flatpak's.
exec /app/lib/jorkonvo/jorkonvo-desktop --no-sandbox "$@"
