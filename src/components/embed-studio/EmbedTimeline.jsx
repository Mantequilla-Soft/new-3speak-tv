import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { StepProgress } from '../legacy-studio/StepProgress';
import EmbedUploadProgressBar from './EmbedUploadProgressBar';
import StepActions from './StepActions';
import TimelineEditor, { chapterIssues, withTimelineKeys } from '../timeline/TimelineEditor';
import { useEmbedUpload } from '../../context/EmbedUploadContext';
import { chaptersFromText } from '../../utils/videoTimeline';
import { toastIn } from '../../utils/toast';
import '../legacy-studio/StudioPage.scss';
import './EmbedTimeline.scss';

const toast = toastIn('Upload');

/**
 * Upload step 4 of 5 (long-form only): chapters and link toasters, edited
 * against the local file. Nothing is encoded yet (that waits for publish), so the
 * only playable source is the File itself; a prefilled upload (Hangouts
 * recording) has none and gets manual time entry instead.
 */
export default function EmbedTimeline() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    step, setStep,
    title, description,
    fromStories,
    completed,
    videoFile, prevVideoFile, videoDuration,
    selectedThumbnail,
    chapters, setChapters,
    timelineLinks, setTimelineLinks,
    timelineSeeded, setTimelineSeeded,
    startEarlyUpload,
  } = useEmbedUpload();

  // 🔧 Same temporary ?devstep hack as the other steps: lets the page render
  // without an upload behind it, for layout work. Publishing will not work.
  const devStep = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('devstep');

  useEffect(() => { setStep(4); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The background upload starts on Details; keep it going if someone landed
  // here first (a reload, the back button). Idempotent.
  useEffect(() => { startEarlyUpload?.(); }, [startEarlyUpload]);

  // First visit: chapters already typed into the description become the
  // starting list. Once only, so emptying the list here is not undone.
  useEffect(() => {
    if (timelineSeeded) return;
    setTimelineSeeded(true);
    if (chapters.length) return;
    const found = chaptersFromText(description);
    if (found.length) setChapters(withTimelineKeys(found));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const file = prevVideoFile || videoFile;
  const [src, setSrc] = useState(null);
  useEffect(() => {
    if (!file) { setSrc(null); return undefined; }
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const duration = useMemo(() => {
    const d = Number(videoDuration);
    return Number.isFinite(d) && d > 0 ? d : 0;
  }, [videoDuration]);

  if (fromStories) return <Navigate to="/embed-studio/preview" replace />;
  if (!completed && !devStep && (!selectedThumbnail || !description || !title)) {
    return <Navigate to="/embed-studio" replace />;
  }

  const goPreview = () => {
    navigate('/embed-studio/preview');
    setStep(5);
  };

  const next = () => {
    if (chapterIssues(chapters, duration).length) {
      toast.error(t('upload.timeline.fixChapters'));
      return;
    }
    goPreview();
  };

  // Rendered above and below the editor from this one object.
  const actions = {
    back: { label: t('common.actions.back'), onClick: () => navigate('/embed-studio/details') },
    // Skip = "no timeline", so it is offered only while there is none; once
    // something was added, Next checks it on the way out.
    secondary: [
      !chapters.length && !timelineLinks.length && { key: 'skip', label: t('common.actions.skip'), onClick: goPreview },
    ],
    primary: [{ key: 'next', label: t('common.actions.next'), onClick: next }],
  };

  return (
    <div className="studio-main-container embed-wizard embed-timeline-page">
      <div className="studio-page-header">
        <h1>{t('upload.page.shareVideo')}</h1>
      </div>
      <StepProgress step={step} short={false} />
      <EmbedUploadProgressBar />
      <div className="studio-page-content">
        <StepActions placement="top" {...actions} />
        <div className="embed-timeline">
          <div className="embed-timeline__intro">
            <h2>{t('upload.timeline.title')}</h2>
            <p>{t('upload.timeline.intro')}</p>
          </div>

          <TimelineEditor
            src={src}
            poster={selectedThumbnail}
            duration={duration}
            chapters={chapters}
            links={timelineLinks}
            onChaptersChange={setChapters}
            onLinksChange={setTimelineLinks}
          />
        </div>
        <StepActions placement="bottom" {...actions} />
      </div>
    </div>
  );
}
