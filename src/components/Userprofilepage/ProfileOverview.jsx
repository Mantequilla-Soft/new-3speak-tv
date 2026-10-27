import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Card3 from '../Cards/Card3';
import PlaylistCard from '../Cards/PlaylistCard';
import BarLoader from '../Loader/BarLoader';
import UserAudioList from './UserAudioList';
import ChannelTrailer from './ChannelTrailer';
import CommunitySnaps from './CommunitySnaps';
import ProfileLinksPanel from './ProfileLinksPanel';
import ProfilePlaylistRails, { PlaylistRail } from './ProfilePlaylistRails';
import ProfileAudioPlaylists from './ProfileAudioPlaylists';
import { LayoutDnd, EditableSection, LayoutEditBar, FreeCell, RowGap, HiddenTray, DockGuide } from './ProfileLayoutEditor';
import ProfileLayoutTour from './ProfileLayoutTour';
import { ProfileLiveNow } from './ProfileStreams';
import {
  SECTION_DEFS, DEFAULT_SECTIONS, normalizeLayout, useProfileLayout, saveProfileLayout, resetProfileLayout,
  isShowablePlaylist, useProfileAudioPlaylists, newSectionId, withDefaults,
  GRID_COLUMNS, MIN_SPAN, layoutRows, dropSection, dockSection, setColumnSpan, swapSection, removeSection,
  trailerSpan, isSideColumn, layoutTourSeen, mobileSections, moveInColumn, LAYOUT_EDIT_EVENT, takeLayoutEditRequest,
} from '../../lib/profileLayout';
import { toastIn } from '../../utils/toast';
import { useTranslation } from 'react-i18next';
import './ProfileOverview.scss';

const toast = toastIn('Profile');

/**
 * The Overview tab: a channel trailer, then a short preview row of each kind of
 * thing this creator makes, each with a way through to the full tab.
 *
 * The point is that a visitor can see the shape of a channel without choosing a
 * tab first — the old default dropped you straight into an endless video list,
 * which said nothing about whether they also make shorts, audio or playlists.
 *
 * Which sections show, in what order, how many entries and as a row or a grid
 * is the creator's choice (lib/profileLayout.js). "Customize profile" on your
 * own Overview turns the page itself into the editor: every section (hidden
 * ones too, dimmed) gets a frame with a drag grip and a properties icon
 * (ProfileLayoutEditor). A creator who never customised gets DEFAULT_SECTIONS,
 * the page as it always was.
 *
 * Sections with nothing in them are omitted rather than shown empty.
 *
 * On desktop the creator's Spotlight links sit in a sticky column beside all
 * this (ProfileLinksPanel); phones and tablets keep the single column.
 */

function Section({ title, count, view = 'row', className = '', onViewMore, children }) {
  const { t } = useTranslation();
  if (!count) return null;
  return (
    <section className={`pov-section pov-section--${view} ${className}`}>
      <div className="pov-head">
        <h3>{title}</h3>
        {onViewMore ? (
          <button type="button" className="pov-more" onClick={onViewMore}>
            {t('profile.overview.viewMore')}
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

const sameLayout = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Undo history: at most this many steps, and changes to the same thing within
// MERGE_MS of each other count as one step.
const HISTORY_MAX = 60;
const MERGE_MS = 1000;
// Only settings that change continuously (a drag, a slider, typing) merge;
// a click on the eye or a size button is always a step of its own.
const CONTINUOUS = ['span', 'count', 'playlists', 'title'];
const mergeKeyFor = (layer, id, change) => {
  const keys = Object.keys(change);
  return keys.length && keys.every((k) => CONTINUOUS.includes(k)) ? `${layer}:${id}:${keys.sort().join(',')}` : null;
};

export default function ProfileOverview({
  username,
  isOwnProfile = false,
  videos = [],
  shorts = [],
  playlists = [],
  snapCount = 0,
  onOpenTab,
  getContentForVideo,
  isWatched,
  getViewCount,
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // The links column only exists on desktop — mobile keeps the layout it had.
  // Gated in JS rather than CSS so a phone never pays for the extra Hive read.
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1025px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1025px)');
    const on = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // Phones (and the narrowest tablets) get the one-column phone layout.
  const [isPhoneWidth, setIsPhoneWidth] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const on = () => setIsPhoneWidth(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // ── layout ────────────────────────────────────────────────────────────────
  // Nothing renders until the layout is known: drawing the default first and
  // then reshuffling into the creator's order would jump the whole page. A
  // failed read falls back to the default.
  const { data: stored, isLoading: layoutLoading } = useProfileLayout(username);
  const saved = useMemo(() => normalizeLayout(stored?.sections), [stored]);
  // The phone layout as stored (null = phones follow the desktop layout).
  const savedMobile = stored?.mobile || null;
  // Non-null = edit mode: { user, sections, mobile }. Tied to the profile it
  // was started on, so moving to another profile (or account) drops an unsaved
  // draft. `mobile` stays null (following the desktop) until something is
  // changed in mobile mode.
  const [edit, setEdit] = useState(null);
  const draft = edit?.user === username ? edit.sections : null;
  const stopEditing = () => setEdit(null);

  // ── undo / redo ──
  // Every change goes through commit(): the state before it goes onto `past`
  // (and a new change clears `future`). Changes sharing a `mergeKey` within
  // MERGE_MS of each other are ONE step: a width drag, a slider, typing a
  // heading. Functional form throughout, for handlers that outlive a render
  // (a width drag keeps calling onPatch while the draft moves under it).
  const commit = (fn, mergeKey = null) => setEdit((e) => {
    if (!e) return e;
    const cur = { sections: e.sections, mobile: e.mobile };
    const next = fn(cur);
    if (next.sections === cur.sections && next.mobile === cur.mobile) return e;
    const now = Date.now();
    const merge = mergeKey && e.lastKey === mergeKey && now - e.lastAt < MERGE_MS;
    return {
      ...e,
      ...next,
      past: merge ? e.past : [...e.past, cur].slice(-HISTORY_MAX),
      future: [],
      lastKey: mergeKey,
      lastAt: now,
    };
  });
  const undo = () => setEdit((e) => (e?.past.length ? {
    ...e,
    ...e.past[e.past.length - 1],
    past: e.past.slice(0, -1),
    future: [{ sections: e.sections, mobile: e.mobile }, ...e.future],
    lastKey: null,
  } : e));
  const redo = () => setEdit((e) => (e?.future.length ? {
    ...e,
    ...e.future[0],
    past: [...e.past, { sections: e.sections, mobile: e.mobile }],
    future: e.future.slice(1),
    lastKey: null,
  } : e));
  const updateDraft = (fn, mergeKey) => commit((c) => ({ ...c, sections: fn(c.sections) }), mergeKey);
  // The first change in mobile mode gives phones a layout of their own.
  const updateMobile = (fn, mergeKey) => commit((c) => ({ ...c, mobile: fn(mobileSections(c.sections, c.mobile)) }), mergeKey);
  const [device, setDevice] = useState('desktop');
  // A phone can only show (and so only edit) the phone layout.
  const editDevice = isPhoneWidth ? 'mobile' : device;
  const [saving, setSaving] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const sections = draft || saved;
  const editing = isOwnProfile && !!draft;

  const showablePlaylists = useMemo(() => playlists.filter(isShowablePlaylist), [playlists]);

  // Fetched only when the section is on (or being edited, to preview it).
  const audioPlaylistsOn = sections.some((s) => s.type === 'audioPlaylists' && (!s.hidden || editing));
  const { data: audioPlaylists = [] } = useProfileAudioPlaylists(audioPlaylistsOn ? username : null);

  // "Customize profile" in the profile header (ProfilePage) opens edit mode
  // here, switching to this tab first if needed: hence the request flag as
  // well as the event. Already editing: nothing happens.
  useEffect(() => {
    if (!isOwnProfile || layoutLoading) return undefined;
    const open = () => {
      if (!takeLayoutEditRequest()) return;
      setEdit((e) => (e?.user === username ? e : {
        user: username, sections: saved, mobile: savedMobile, past: [], future: [], lastKey: null, lastAt: 0,
      }));
      // The first time only; the edit bar's "?" brings it back.
      if (!layoutTourSeen()) setTourOpen(true);
    };
    const pending = setTimeout(open, 0);   // asked for before this tab was mounted
    window.addEventListener(LAYOUT_EDIT_EVENT, open);
    return () => { clearTimeout(pending); window.removeEventListener(LAYOUT_EDIT_EVENT, open); };
  }, [isOwnProfile, layoutLoading, username, saved, savedMobile]);

  // Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z or Ctrl+Y redoes. Not while typing in
  // a field: there the keys mean the field's own undo.
  useEffect(() => {
    if (!editing) return undefined;
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const el = e.target;
      if (el?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); redo(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editing]);   // undo/redo only call setEdit with a function: bound once per edit session

  const draftMobile = draft && edit.mobile ? mobileSections(draft, edit.mobile) : null;
  const dirty = editing && (
    !sameLayout(draft, saved)
    || !sameLayout(draftMobile, savedMobile ? mobileSections(saved, savedMobile) : null)
  );

  const saveDraft = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      // Saving the default order (and no phone layout of its own) is the same
      // as having none: drop the stored copy, so later changes to the default
      // still reach this profile.
      const isDefault = !draftMobile && sameLayout(draft, normalizeLayout(DEFAULT_SECTIONS));
      const layout = isDefault
        ? await resetProfileLayout(username)
        : await saveProfileLayout(username, draft, draftMobile);
      queryClient.setQueryData(['profile-layout', String(username).toLowerCase()], layout);
      stopEditing();
      toast.success(t('profile.layout.saved'));
    } catch (err) {
      toast.error(err.status === 401
        ? t('profile.layout.signInNeeded')
        : t('profile.layout.saveFailed', { error: err.message }));
    } finally {
      setSaving(false);
    }
  };

  // Community cards route through here for "Read more" and the comment button —
  // `permlink`/`opts` come straight from SnapCard's onOpenTab(permlink, opts).
  const openCommunityTab = (permlink, opts) => onOpenTab('community', permlink, opts);

  const heading = (s) => s.title || t(SECTION_DEFS[s.type].labelKey);

  // ── edit mode helpers ─────────────────────────────────────────────────────
  const playlistName = (s) => (s.type === 'playlist'
    ? showablePlaylists.find((p) => p.id === s.playlistId)?.name
    : null);
  const editLabel = (s) => s.title || playlistName(s) || t(SECTION_DEFS[s.type].labelKey);
  // The section's kind under a custom name ("My best bits · Videos").
  const editKind = (s) => (s.title || playlistName(s) ? t(SECTION_DEFS[s.type].labelKey) : null);
  // A width is the width of the section's whole column (sections stacked in
  // a column share it), so `span` always goes through setColumnSpan.
  const patchSection = (id, change) => updateDraft((list) => {
    const before = list.find((s) => s.id === id);
    if (!before) return list;
    const { span: askedSpan, ...rest } = change;
    let next = list.map((s) => (s.id === id ? { ...s, ...rest } : s));
    const after = next.find((s) => s.id === id);
    let span = askedSpan;
    // Switching the trailer's text and community note off leaves just the
    // player, so its column narrows to the player's size (and back to the
    // full row when either comes back). Resizing afterwards still wins.
    if (after.type === 'trailer' && ('size' in change || 'showInfo' in change || 'showSnap' in change)) {
      span = trailerSpan(after);
    }
    // Links moved into the grid from its gear: a column's width, not a row's.
    if (after.type === 'links' && change.side === 'none' && before.side !== 'none' && after.span === GRID_COLUMNS) {
      span = 4;
    }
    if (span != null) next = setColumnSpan(next, id, span);
    return next;
  }, mergeKeyFor('d', id, change));
  // Earlier/later among the sections on the page (hidden ones are skipped, or
  // a click could swap with something invisible and seem to do nothing).
  const shiftSection = (id, dir) => updateDraft((list) => swapSection(list, id, dir));
  const placedPlaylists = new Set(sections.filter((s) => s.type === 'playlist').map((s) => s.playlistId));
  const addablePlaylists = sections.filter((s) => s.type === 'playlist').length < 10
    ? showablePlaylists.filter((p) => !placedPlaylists.has(p.id))
    : [];
  const addPlaylistSection = (playlistId) => {
    if (!playlistId) return;
    // At the top, where the creator is looking; they drag it from there.
    updateDraft((list) => [withDefaults({ id: newSectionId('playlist'), type: 'playlist', playlistId }), ...list]);
  };

  // Mobile mode: the phone layout inside a drawn phone (on a real phone, as is).
  const patchMobile = (id, change) => updateMobile((list) => list.map((s) => {
    if (s.id !== id) return s;
    const { span: _ignored, ...rest } = change;   // one column: no widths here
    return { ...s, ...rest };
  }), mergeKeyFor('m', id, change));
  const renderPhoneEditor = () => {
    const list = mobileSections(draft, edit.mobile);
    const shown = list.filter((s) => !s.hidden);
    const body = (
      <div className="pov-grid pov-grid--editing pov-grid--phone">
        {shown.map((s, i) => (
          <div key={s.id} className="pov-col" style={{ gridColumn: '1 / -1' }}>
            <EditableSection
              section={s}
              mobile
              label={editLabel(s)}
              kind={editKind(s)}
              playlists={showablePlaylists}
              isFirst={i === 0}
              isLast={i === shown.length - 1}
              onPatch={(change) => patchMobile(s.id, change)}
              onMoveEarlier={() => updateMobile((l) => swapSection(l, s.id, -1))}
              onMoveLater={() => updateMobile((l) => swapSection(l, s.id, 1))}
            >
              {renderSection(s, false, true)}
            </EditableSection>
          </div>
        ))}
      </div>
    );
    return (
      <>
        {isPhoneWidth ? body : (
          <div className="ple-phone">
            <div className="ple-phone-screen">{body}</div>
          </div>
        )}
        <HiddenTray
          sections={list.filter((s) => s.hidden)}
          labelFor={editLabel}
          onShow={(id) => patchMobile(id, { hidden: false })}
        />
      </>
    );
  };

  // `fill`: the section shares its row, so it stretches to the row's height
  // (only the links page does anything with it). `phone`: drawn in the phone
  // preview, where the trailer is full width and never has its note beside it.
  const renderSection = (s, fill = false, phone = false) => {
    switch (s.type) {
      case 'trailer':
        return (
          <ChannelTrailer
            username={username}
            isOwnProfile={isOwnProfile}
            onOpenCommunityTab={openCommunityTab}
            size={phone ? 'full' : s.size}
            showInfo={s.showInfo}
            showSnap={phone ? false : s.showSnap}
          />
        );
      case 'live':
        // Streaming right now. Nothing when not live.
        return <ProfileLiveNow user={username} />;
      case 'videos': {
        const list = videos.slice(0, s.count);
        return (
          <Section title={heading(s)} count={list.length} view={s.view} onViewMore={() => onOpenTab('video')}>
            <Card3 videos={list} getContentForVideo={getContentForVideo} isWatched={isWatched} getViewCount={getViewCount} />
          </Section>
        );
      }
      case 'shorts': {
        const list = shorts.slice(0, s.count);
        return (
          <Section title={heading(s)} count={list.length} view={s.view} onViewMore={() => onOpenTab('shorts')}>
            <Card3 videos={list} shortsGrid linkPrefix="/shorts" getViewCount={getViewCount} />
          </Section>
        );
      }
      case 'audio':
        // Audio owns its own data, so it renders limited rather than sliced
        // here, and the stylesheet hides the section when it comes back empty.
        return (
          <Section title={heading(s)} count={1} view={s.view} className="pov-section--audio" onViewMore={() => onOpenTab('audio')}>
            <UserAudioList user={username} limit={s.count} />
          </Section>
        );
      case 'audioPlaylists': {
        const list = audioPlaylists.slice(0, s.count);
        return (
          <Section title={heading(s)} count={list.length} view={s.view} onViewMore={() => onOpenTab('playlists')}>
            <ProfileAudioPlaylists playlists={list} />
          </Section>
        );
      }
      case 'community':
        return (
          <Section title={heading(s)} count={snapCount} view={s.view} onViewMore={() => onOpenTab('community')}>
            <CommunitySnaps user={username} limit={s.count} hideEmpty onOpenTab={openCommunityTab} />
          </Section>
        );
      case 'playlistRails':
        // What's actually IN the playlists: one rail per playlist. Each loads
        // only when scrolled to (ProfilePlaylistRails).
        return (
          <ProfilePlaylistRails
            playlists={playlists}
            maxPlaylists={s.playlists}
            count={s.count}
            view={s.view}
            getContentForVideo={getContentForVideo}
            isWatched={isWatched}
            getViewCount={getViewCount}
          />
        );
      case 'playlist': {
        const playlist = showablePlaylists.find((p) => p.id === s.playlistId);
        if (!playlist) return null;
        return (
          <PlaylistRail
            playlist={playlist}
            count={s.count}
            title={s.title}
            view={s.view}
            getContentForVideo={getContentForVideo}
            isWatched={isWatched}
            getViewCount={getViewCount}
          />
        );
      }
      case 'playlists': {
        const list = playlists.slice(0, s.count);
        return (
          <Section title={heading(s)} count={list.length} view={s.view} onViewMore={() => onOpenTab('playlists')}>
            <PlaylistCard playlists={list} />
          </Section>
        );
      }
      case 'links':
        // The links page placed IN the grid (side 'none'). Desktop only, like
        // the side column: phones have ProfileLinksButton in the header.
        return isDesktop
          ? <ProfileLinksPanel username={username} isOwnProfile={isOwnProfile} onOpenTab={onOpenTab} inGrid fill={fill} />
          : null;
      default:
        return null;
    }
  };

  const links = sections.find((s) => s.type === 'links');
  const sideLinks = links && isSideColumn(links) ? links : null;
  const showLinks = isDesktop && sideLinks && !sideLinks.hidden;

  const page = (
    <div className={`profile-overview${links?.side === 'left' ? ' profile-overview--links-left' : ''}`}>
      <div className="pov-main">
        {layoutLoading ? <BarLoader /> : editing ? (
          <>
            <LayoutEditBar
              dirty={dirty}
              saving={saving}
              onSave={saveDraft}
              onCancel={stopEditing}
              onReset={() => (editDevice === 'mobile'
                ? commit((c) => ({ ...c, mobile: null }))   // phones follow the desktop again
                : updateDraft(() => normalizeLayout(DEFAULT_SECTIONS)))}
              canUndo={!!edit?.past.length}
              canRedo={!!edit?.future.length}
              onUndo={undo}
              onRedo={redo}
              device={editDevice}
              onDevice={isPhoneWidth ? null : setDevice}
              addablePlaylists={addablePlaylists}
              onAddPlaylist={addPlaylistSection}
              onTour={() => setTourOpen(true)}
            />
            {tourOpen ? <ProfileLayoutTour onClose={() => setTourOpen(false)} /> : null}
            {editDevice === 'mobile' ? renderPhoneEditor() : (
            <>
            {/* The same 12-column grid visitors get, plus each row's empty
                  columns as a drop target. (No column guides: the user found
                  them confusing, 2026-10-27.) */}
              <div className="pov-grid pov-grid--editing">
                <DockGuide />
                {(() => {
                  // Rows of columns; each column a stack of sections. Between
                  // the rows (and after the last), a "New row" drop line.
                  const rows = layoutRows(draft);
                  const flow = rows.flatMap((row) => row.flatMap((col) => col.items));
                  return [
                    ...rows.flatMap((row) => {
                      const free = GRID_COLUMNS - row.reduce((n, c) => n + c.span, 0);
                      const lastCol = row[row.length - 1];
                      const last = lastCol.items[lastCol.items.length - 1];
                      const firstId = row[0].items[0].id;
                      return [
                        <RowGap key={`gap-${firstId}`} beforeId={firstId} />,
                        ...row.map((col) => {
                          // A lone links page in a row of several columns
                          // stretches to the row's height.
                          const fill = row.length > 1 && col.items.length === 1 && col.items[0].type === 'links';
                          return (
                            <div
                              key={`col-${col.items[0].id}`}
                              className={`pov-col${fill ? ' pov-col--fill' : ''}`}
                              style={{ gridColumn: `span ${col.span}` }}
                            >
                              {col.items.map((s) => (
                                <EditableSection
                                  key={s.id}
                                  section={s}
                                  className={fill ? 'ple-frame--fill' : ''}
                                  label={editLabel(s)}
                                  kind={editKind(s)}
                                  playlists={showablePlaylists}
                                  isFirst={flow[0].id === s.id}
                                  isLast={flow[flow.length - 1].id === s.id}
                                  onPatch={(change) => patchSection(s.id, change)}
                                  onMoveEarlier={() => shiftSection(s.id, -1)}
                                  onMoveLater={() => shiftSection(s.id, 1)}
                                  onRemove={() => updateDraft((list) => removeSection(list, s.id))}
                                >
                                  {renderSection(s, fill)}
                                </EditableSection>
                              ))}
                            </div>
                          );
                        }),
                        free >= MIN_SPAN ? <FreeCell key={`free-${last.id}`} afterId={last.id} span={free} /> : null,
                      ];
                    }),
                    <RowGap key="gap-end" beforeId={null} />,
                  ];
                })()}
              </div>
            <HiddenTray
              sections={draft.filter((s) => s.hidden && !isSideColumn(s))}
              labelFor={editLabel}
              onShow={(id) => patchSection(id, { hidden: false })}
            />
            </>
            )}
          </>
        ) : isPhoneWidth ? (
          // Phones: the phone layout, one section under the other.
          <div className="pov-grid">
            {mobileSections(saved, savedMobile).filter((s) => !s.hidden).map((s) => (
              <div key={s.id} className="pov-slot" data-section={s.type}>{renderSection(s)}</div>
            ))}
          </div>
        ) : (
          <div className="pov-grid">
            {layoutRows(sections).flatMap((row) => row.map((col) => {
              const fill = row.length > 1 && col.items.length === 1 && col.items[0].type === 'links';
              return (
                <div
                  key={col.items[0].id}
                  className={`pov-col${fill ? ' pov-col--fill' : ''}`}
                  style={{ gridColumn: `span ${col.span}` }}
                >
                  {col.items.map((s) => (
                    <div key={s.id} className={`pov-slot${fill ? ' pov-slot--fill' : ''}`} data-section={s.type}>
                      {renderSection(s, fill)}
                    </div>
                  ))}
                </div>
              );
            }))}
          </div>
        )}
      </div>

      {/* The links page as a column beside the grid. In edit mode its frame
          has a grip too: dropped onto the grid it becomes a section there. */}
      {editing && editDevice === 'mobile' ? null : editing && isDesktop && sideLinks ? (
        <EditableSection
          section={sideLinks}
          sideColumn
          className="ple-frame--links"
          label={editLabel(sideLinks)}
          onPatch={(change) => patchSection(sideLinks.id, change)}
        >
          <ProfileLinksPanel username={username} isOwnProfile={isOwnProfile} onOpenTab={onOpenTab} />
        </EditableSection>
      ) : showLinks ? (
        <ProfileLinksPanel username={username} isOwnProfile={isOwnProfile} onOpenTab={onOpenTab} />
      ) : null}
    </div>
  );

  // Edit mode: the drag context spans the whole tab, side column included.
  // Mobile mode drags within the phone's single column instead.
  if (editing && editDevice === 'mobile') {
    return (
      <LayoutDnd
        sections={mobileSections(draft, edit.mobile)}
        vertical
        onDrop={(activeId, overId, side) => updateMobile((list) => moveInColumn(list, activeId, overId, side))}
        onDock={() => {}}
        labelFor={editLabel}
      >
        {page}
      </LayoutDnd>
    );
  }
  return editing ? (
    <LayoutDnd
      sections={draft}
      onDrop={(activeId, overId, side) => updateDraft((list) => dropSection(list, activeId, overId, side))}
      onDock={(activeId, side) => updateDraft((list) => dockSection(list, activeId, side))}
      labelFor={editLabel}
    >
      {page}
    </LayoutDnd>
  ) : page;
}
