// Helpers shared by the v2 primitives (kept out of ui.jsx so Fast Refresh works).
import { isValidElement } from "react";
import { Icon } from "./Icon";

export const cx = (...a) => a.filter(Boolean).join(" ");

// `icon` props take a Material Symbols name ("share"), an element, or a
// component that accepts `size` (Icon.of("share"), lucide, react-icons).
export function renderIcon(icon, size, props = {}) {
  if (!icon) return null;
  if (typeof icon === "string") return <Icon name={icon} size={size} {...props} />;
  if (isValidElement(icon)) return icon;
  const C = icon;
  return <C size={size} aria-hidden {...props} />;
}
