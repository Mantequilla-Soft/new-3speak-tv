import { lazy, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../v2/Icon';
import MountWhenOpened from '../LazyMount';
import { useFocusBackdrop } from './focusBackdrop';

const FocusWriter = lazy(() => import('./FocusWriter'));

/**
 * The focus-mode button of a comment box's tools: opens FocusWriter (its own
 * chunk, typewriter font included) on the box's text. On close the box gets
 * its height back and the caret, so the comment can be posted from there.
 */
export default function FocusWriterButton({ value, setValue, inputRef, placeholder, className = 'egp-btn' }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const backdrop = useFocusBackdrop();
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => {
      const el = inputRef?.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
      el.focus({ preventScroll: true });
    });
  };
  return (
    <>
      <button
        type="button"
        className={className}
        aria-haspopup="dialog"
        aria-label={t('comments.focus.open')}
        title={t('comments.focus.open')}
        onClick={() => setOpen(true)}
      >
        <Icon name="center_focus_strong" size={18} />
      </button>
      <MountWhenOpened when={open} name="focus-writer">
        {open && <FocusWriter value={value} onChange={setValue} placeholder={placeholder} backdrop={backdrop} onClose={close} />}
      </MountWhenOpened>
    </>
  );
}
