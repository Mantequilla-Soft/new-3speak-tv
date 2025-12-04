import React from "react";
import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data";

export default function EmojiPicker({ onSelect }) {
  return (
    <Picker
      data={data}
      onEmojiSelect={(emoji) => onSelect(emoji.native)}
      previewPosition="none"
    />
  );
}
