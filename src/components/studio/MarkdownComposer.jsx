import Composer from '../common/Composer/Composer';

/**
 * A post field (a video's description, a snap, a Short's text...): the one
 * editor (common/Composer) in its full view. Kept as its own name so the post
 * forms read as before; every tool lives in Composer.
 *
 * `previewContext`: 'post-body' (a description, no 3Speak player embeds: its
 * page already plays one) or 'snap' (embeds stay).
 */
export default function MarkdownComposer({ value, onChange, placeholder, previewContext = 'post-body' }) {
  return (
    <Composer
      mode="full"
      expandable={false}
      value={value ?? ''}
      onChange={onChange}
      placeholder={placeholder}
      previewContext={previewContext}
    />
  );
}
