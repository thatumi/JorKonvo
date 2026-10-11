import { getMemberRoleIcons, type Room } from "@jorkonvo/matrix-core";
import { useAuthedMedia } from "../lib/authedMedia";

/** One role-icon <img>. Kept as its own component so each gets its own useAuthedMedia hook. */
function RoleIcon({ mxc, size }: { mxc: string; size: number }) {
  const src = useAuthedMedia(mxc, { width: size * 2, height: size * 2, method: "scale", animated: true });
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      role="listitem"
      className="inline-block shrink-0 object-contain align-text-bottom"
      style={{ width: size, height: size }}
    />
  );
}

/**
 * Discord-style role icons / badges shown next to a member's name - the
 * `icon` of each assigned space role (see roles.ts). Renders nothing when
 * the space has none or the user isn't in a space.
 */
export function RoleBadges({
  space,
  userId,
  size = 14,
}: {
  space: Room | null;
  userId: string;
  size?: number;
}) {
  if (!space) return null;
  const icons = getMemberRoleIcons(space, userId);
  if (icons.length === 0) return null;
  return (
    <span role="list" className="ml-1 inline-flex items-center gap-0.5">
      {icons.map((mxc) => (
        <RoleIcon key={mxc} mxc={mxc} size={size} />
      ))}
    </span>
  );
}
