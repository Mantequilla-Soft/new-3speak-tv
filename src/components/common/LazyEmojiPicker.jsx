import { lazy } from 'react';
import { LazyBoundary } from './LazyMount';

// emoji-picker-react + its emoji data is ~840 KB of JavaScript. It used to be a
// static import of the composers, which put it in the first download of every
// page (the home page included, through the community snaps composer). Now it
// is fetched the first time someone opens an emoji picker.
const EmojiPicker = lazy(() => import('emoji-picker-react'));

// Same props as emoji-picker-react's default export. While the chunk loads, an
// empty box of the picker's size holds its place so the popover does not jump.
export default function LazyEmojiPicker(props) {
  const { width = 350, height = 450 } = props;
  const placeholder = <div className="lazy-emoji-picker-loading" style={{ width, height }} aria-busy="true" />;
  return (
    <LazyBoundary fallback={placeholder} name="emoji picker">
      <EmojiPicker {...props} />
    </LazyBoundary>
  );
}
