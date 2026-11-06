import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { MdVideoLibrary, MdAudiotrack, MdPodcasts, MdLibraryMusic, MdKeyboardVoice, MdGraphicEq } from 'react-icons/md';
import { AUDIO_KINDS } from '../../lib/playlistType';
import './PlaylistTypePicker.scss';

const KIND_ICONS = { podcast: MdPodcasts, music: MdLibraryMusic, voice: MdKeyboardVoice, sounds: MdGraphicEq };

/**
 * Video / Audio, and for audio the kind (lib/playlistType.js). Draws its
 * buttons in the surrounding form's style: `groupClass` is that form's
 * button-row class, `btnClass` its button class (`active` marks the pick).
 * `audioOnly` leaves out the Video / Audio row, for forms that only make
 * audio playlists.
 */
export default function PlaylistTypePicker({
  type, kind, onChange, groupClass = 'privacy-buttons', btnClass = 'privacy-btn', labelClass = 'form-label',
  audioOnly = false, disabled = false, iconSize = 18,
}) {
  const { t } = useTranslation();
  const id = useId();
  // Set here, not in the stylesheet: each host form's own `.privacy-btn` rule
  // (flex: 1, svg size) is more specific than anything this component ships.
  const icon = { size: iconSize, style: { flexShrink: 0 } };
  const kindBtnStyle = { flex: '1 1 calc(50% - 10px)', minWidth: 0 };
  const pick = (nextType, nextKind = kind) => onChange({ type: nextType, kind: nextType === 'audio' ? (nextKind || 'podcast') : null });

  return (
    <>
      {!audioOnly && <div className="form-group">
        <span className={labelClass} id={`${id}-type`}>{t('playlists.type.label')}</span>
        <div className={groupClass} role="group" aria-labelledby={`${id}-type`}>
          <button type="button" disabled={disabled} aria-pressed={type !== 'audio'} className={`${btnClass} ${type !== 'audio' ? 'active' : ''}`} onClick={() => pick('video')}>
            <MdVideoLibrary {...icon} /> {t('playlists.type.video')}
          </button>
          <button type="button" disabled={disabled} aria-pressed={type === 'audio'} className={`${btnClass} ${type === 'audio' ? 'active' : ''}`} onClick={() => pick('audio')}>
            <MdAudiotrack {...icon} /> {t('playlists.type.audio')}
          </button>
        </div>
      </div>}
      {(audioOnly || type === 'audio') && (
        <div className="form-group">
          <span className={labelClass} id={`${id}-kind`}>{t('playlists.type.kindLabel')}</span>
          <div className={`${groupClass} playlist-type-kinds`} role="group" aria-labelledby={`${id}-kind`}>
            {AUDIO_KINDS.map((k) => {
              const Icon = KIND_ICONS[k];
              return (
                <button key={k} type="button" disabled={disabled} aria-pressed={kind === k} className={`${btnClass} ${kind === k ? 'active' : ''}`} style={kindBtnStyle} onClick={() => pick('audio', k)}>
                  <Icon {...icon} /> {t(`playlists.type.kinds.${k}`)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
