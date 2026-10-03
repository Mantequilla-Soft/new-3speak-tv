import EmojiPickerReact from "emoji-picker-react";
import { useAppStore } from "../../lib/store";
import { useTranslation } from "react-i18next";

/**
 * Emoji picker for the Tiptap toolbar. Wraps emoji-picker-react — the same
 * picker the chat and comment composers use — so the app ships one emoji
 * library instead of two. The `onSelect(char)` contract is unchanged, so
 * TiptapEditor needs no edit; positioning still comes from `.EmojiPickerReact`
 * in editor.scss.
 */
export default function EmojiPicker({ onSelect }) {
  const { t } = useTranslation();
  const appTheme = useAppStore((s) => s.theme);

  return (
    <EmojiPickerReact
      onEmojiClick={(d) => onSelect(d.emoji)}
      theme={appTheme === "light" ? "light" : "dark"}
      lazyLoadEmojis
      width={250}
      height={300}
      previewConfig={{ showPreview: false }}
      searchPlaceholder={t("editor.emoji.searchPlaceholder")}
    />
  );
}
