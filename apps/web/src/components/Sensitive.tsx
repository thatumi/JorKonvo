import { useState } from "react";
import { useStreamerModeStore } from "../lib/streamerMode";

/**
 * Blurs its children while Streamer Mode is on (Discord's "hidden" personal
 * info - email, invite links, etc.), revealing on hover/focus so the owner
 * can still read it. A transparent passthrough when Streamer Mode is off.
 */
export function Sensitive({ children }: { children: React.ReactNode }) {
  const streamerMode = useStreamerModeStore((s) => s.enabled);
  const [revealed, setRevealed] = useState(false);

  if (!streamerMode) return <>{children}</>;

  return (
    <span
      aria-pressed={revealed}
      onMouseEnter={() => setRevealed(true)}
      onMouseLeave={() => setRevealed(false)}
      onFocus={() => setRevealed(true)}
      onBlur={() => setRevealed(false)}
      className={
        revealed
          ? "transition-[filter]"
          : "cursor-pointer select-none blur-sm transition-[filter] hover:blur-none"
      }
      title=""
    >
      {children}
    </span>
  );
}
