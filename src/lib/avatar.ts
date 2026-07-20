const AVATAR_COLOR_CLASSES = [
  "bg-blue-600",
  "bg-emerald-600",
  "bg-rose-600",
  "bg-amber-700",
  "bg-cyan-700",
  "bg-slate-600",
] as const;

export function avatarInitials(label: string) {
  const parts = label.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "U";
}

/** A deterministic color gives each user a stable Google-style fallback avatar. */
export function avatarColorClass(label: string) {
  let hash = 0;
  for (let index = 0; index < label.length; index += 1) {
    hash = (hash * 31 + label.charCodeAt(index)) | 0;
  }
  return AVATAR_COLOR_CLASSES[Math.abs(hash) % AVATAR_COLOR_CLASSES.length];
}
