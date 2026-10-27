import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext, DragOverlay, useDraggable, useDroppable, PointerSensor, useSensor, useSensors, pointerWithin,
} from '@dnd-kit/core';
import { RxDragHandleDots2 } from 'react-icons/rx';
import {
  FiChevronDown, FiChevronUp, FiEye, FiEyeOff, FiSettings, FiTrash2, FiPlus, FiX, FiHelpCircle, FiMonitor, FiSmartphone,
  FiRotateCcw, FiRotateCw,
} from 'react-icons/fi';
import { MdViewCarousel, MdGridView } from 'react-icons/md';
import { SECTION_DEFS, GRID_COLUMNS, clampSpan } from '../../lib/profileLayout';
import { useTranslation } from 'react-i18next';
import ModalHeader from '../ModalHeader/ModalHeader';
import './ProfileLayoutEditor.scss';

/**
 * Edit mode for the Overview tab, done on the page itself: every real section
 * gets a frame with a drag grip (pointer or touch), up/down arrows, a show/hide eye and a
 * properties (gear) icon that opens that section's settings. Owner only; see
 * ProfileOverview for how the pieces are put together.
 *
 *   LayoutEditBar   sticky bar: add a playlist section, reset, cancel, save
 *   LayoutDnd       drag context around the 12-column grid
 *   EditableSection the frame around one section (incl. its width handle)
 *   FreeCell        a row's empty columns, as a drop target
 *   RowGap          the line between rows: drop for a new full-width row
 *   DockGuide       the side column the links page will become, while held
 *   HiddenTray      the switched-off sections, below the grid
 */

const PHONE_MQ = '(max-width: 640px)';
function useIsPhone() {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(PHONE_MQ).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_MQ);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

function Segmented({ value, options, onChange }) {
  return (
    <div className="ple-seg" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ checked, label, onChange }) {
  return (
    <label className="ple-switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="ple-switch-track" aria-hidden="true" />
      <span className="ple-switch-label">{label}</span>
    </label>
  );
}

// On a phone the trailer is always full width and its community note never
// shows, and the links page has no place: those settings are desktop-only.
const DESKTOP_ONLY_FLAGS = ['showSnap'];

function SectionSettings({ section, playlists, onPatch, mobile = false }) {
  const { t } = useTranslation();
  const def = SECTION_DEFS[section.type];
  const playlist = section.type === 'playlist' ? playlists.find((p) => p.id === section.playlistId) : null;
  const defaultTitle = playlist?.name || t(def.labelKey);
  const fields = [];

  if (section.type === 'playlist') {
    fields.push(
      <label key="playlist" className="ple-field">
        <span>{t('profile.layout.fields.playlist')}</span>
        <select value={section.playlistId || ''} onChange={(e) => onPatch({ playlistId: e.target.value })}>
          {!playlist ? <option value={section.playlistId || ''}>{t('profile.layout.playlistMissing')}</option> : null}
          {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>,
    );
  }
  if (def.title) {
    fields.push(
      <label key="title" className="ple-field">
        <span>{t('profile.layout.fields.heading')}</span>
        <input
          type="text"
          maxLength={60}
          value={section.title || ''}
          placeholder={defaultTitle}
          onChange={(e) => onPatch({ title: e.target.value || undefined })}
        />
      </label>,
    );
  }
  if (def.size && !mobile) {
    fields.push(
      <div key="size" className="ple-field">
        <span>{t('profile.layout.fields.size')}</span>
        <Segmented
          value={section.size}
          onChange={(size) => onPatch({ size })}
          options={def.size.slice(0, -1).map((v) => ({ value: v, label: t(`profile.layout.fields.size_${v}`) }))}
        />
      </div>,
    );
  }
  Object.keys(def.flags || {}).filter((f) => !mobile || !DESKTOP_ONLY_FLAGS.includes(f)).forEach((flag) => {
    fields.push(
      <Switch
        key={flag}
        checked={section[flag]}
        label={t(`profile.layout.fields.${flag}`)}
        onChange={(on) => onPatch({ [flag]: on })}
      />,
    );
  });
  if (def.playlists) {
    fields.push(
      <label key="playlists" className="ple-field ple-field--range">
        <span>{t('profile.layout.fields.playlists', { count: section.playlists })}</span>
        <input
          type="range"
          min={def.playlists[0]}
          max={def.playlists[1]}
          value={section.playlists}
          onChange={(e) => onPatch({ playlists: Number(e.target.value) })}
        />
      </label>,
    );
  }
  if (def.count) {
    fields.push(
      <label key="count" className="ple-field ple-field--range">
        <span>{t('profile.layout.fields.count', { count: section.count })}</span>
        <input
          type="range"
          min={def.count[0]}
          max={def.count[1]}
          value={section.count}
          onChange={(e) => onPatch({ count: Number(e.target.value) })}
        />
      </label>,
    );
  }
  if (def.view) {
    fields.push(
      <div key="view" className="ple-field">
        <span>{t('profile.layout.fields.view')}</span>
        <Segmented
          value={section.view}
          onChange={(view) => onPatch({ view })}
          options={[
            { value: 'row', label: t('profile.layout.fields.viewRow'), icon: <MdViewCarousel size={15} /> },
            { value: 'grid', label: t('profile.layout.fields.viewGrid'), icon: <MdGridView size={15} /> },
          ]}
        />
      </div>,
    );
  }
  if (def.side && !mobile) {
    fields.push(
      <div key="side" className="ple-field">
        <span>{t('profile.layout.fields.side')}</span>
        <Segmented
          value={section.side}
          onChange={(side) => onPatch({ side })}
          options={[
            { value: 'left', label: t('profile.layout.fields.sideLeft') },
            { value: 'right', label: t('profile.layout.fields.sideRight') },
            { value: 'none', label: t('profile.layout.fields.sideNone') },
          ]}
        />
        <small className="ple-note">{t('profile.layout.linksNote')}</small>
      </div>,
    );
  }

  return fields.length ? fields : <small className="ple-note">{t('profile.layout.noSettings')}</small>;
}

/**
 * The properties of one section. Anchored under its gear on desktop; a bottom
 * sheet on phones (portalled, so no transformed ancestor can trap `fixed`).
 */
function PropertiesPopover({ label, onClose, children }) {
  const { t } = useTranslation();
  const isPhone = useIsPhone();
  const ref = useRef(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    // Outside click closes on desktop; the phone sheet has its own backdrop.
    const onDown = (e) => {
      if (isPhone || !ref.current || ref.current.contains(e.target)) return;
      if (e.target.closest?.('.ple-gear')) return;   // the gear toggles it itself
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [isPhone, onClose]);

  const panel = (
    <div ref={ref} className={`ple-props${isPhone ? ' ple-props--sheet' : ''}`} role="dialog" aria-label={label}>
      {isPhone ? (
        <ModalHeader className="ple-sheet-header" title={label} onClose={onClose} />
      ) : (
        <div className="ple-props-head">
          <strong>{label}</strong>
          <button type="button" className="ple-icon" onClick={onClose} aria-label={t('common.actions.close')}>
            <FiX size={16} />
          </button>
        </div>
      )}
      <div className="ple-props-body">{children}</div>
    </div>
  );

  if (!isPhone) return panel;
  return createPortal(
    <div className="ple-sheet-overlay" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>{panel}</div>
    </div>,
    document.body,
  );
}

const swallow = (e) => { e.preventDefault(); e.stopPropagation(); };

// ── drag & drop ─────────────────────────────────────────────────────────────

const DndState = createContext({ activeId: null, overId: null, side: null, dock: null, arming: null });

// How long the links page has to be held on a row's outer edge before
// releasing it there makes it a full-height side column instead.
const DOCK_HOLD_MS = 700;

// The band along each side of the grid where holding the links page docks it:
// a share of the grid's width (at least a finger's width), and the space
// beyond the grid's edge. Once the column has lit up the band widens, so a
// little wobble while holding still can't drop it again.
const DOCK_BAND = 0.12;
const DOCK_BAND_READY = 0.3;
const DOCK_BAND_MIN_PX = 56;

// One editable grid on the page at a time (ProfileOverview's edit mode).
function dockZone(point, ready) {
  const grid = point && document.querySelector('.pov-grid--editing');
  if (!grid) return null;
  const r = grid.getBoundingClientRect();
  if (point.y < r.top - 40 || point.y > r.bottom + 40) return null;
  const band = Math.max(DOCK_BAND_MIN_PX, r.width * (ready ? DOCK_BAND_READY : DOCK_BAND));
  if (point.x < r.left + band) return 'left';
  if (point.x > r.right - band) return 'right';
  return null;
}

// Which edge of the section under the pointer the drop is aimed at. Measured
// relative to that section's size, so a wide, short row still has a usable
// left/right zone and a narrow, tall one a usable top/bottom.
// `vertical`: a single column (the phone layout), where only above/below exist.
function sideOf(point, rect, vertical = false) {
  if (!point || !rect) return 'bottom';
  const dx = (point.x - (rect.left + rect.width / 2)) / rect.width;
  const dy = (point.y - (rect.top + rect.height / 2)) / rect.height;
  if (!vertical && Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'top' : 'bottom';
}

const pointerOf = (e) => (e.activatorEvent && 'clientX' in e.activatorEvent
  ? { x: e.activatorEvent.clientX + e.delta.x, y: e.activatorEvent.clientY + e.delta.y }
  : null);

/**
 * Drag context around the grid. A section is dragged by its grip; what follows
 * the pointer is a small label (DragOverlay), not the whole section. Dropped on
 * another section's left/right edge it becomes a new column beside it; on its
 * top/bottom edge it stacks into that section's column (or, for a full-width
 * row, gets a row of its own); on a free cell it fills that row's empty
 * columns; on the line between rows it starts a new row there.
 * `onDrop(activeId, overId, side)` does the arithmetic (lib dropSection).
 *
 * The links page can also become a full-height side column: held in the band
 * along the grid's left or right side (dockZone) for DOCK_HOLD_MS, it shows a
 * filling bar on that side, then the whole side lights up and the label says
 * so; releasing then calls `onDock(activeId, 'left' | 'right')`. Releasing
 * sooner is a normal drop beside the section under the pointer. The zone is
 * judged by position, not by what is under the pointer: at the page edge the
 * pointer keeps slipping on and off the section, which reset the hold.
 */
export function LayoutDnd({ sections, onDrop, onDock, labelFor, vertical = false, children }) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [side, setSide] = useState(null);
  const [arming, setArming] = useState(null);   // holding on an outer edge
  const [dock, setDock] = useState(null);       // held long enough: release docks
  const hold = useRef({ zone: null, ready: null, timer: null });
  const clearHold = () => { clearTimeout(hold.current.timer); hold.current = { zone: null, ready: null, timer: null }; };
  useEffect(() => clearHold, []);
  // Pointer only (mouse, touch, pen): drops are found under the pointer, so a
  // keyboard drag would never land. The arrows are the keyboard way.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const active = sections.find((s) => s.id === activeId);

  const track = (e) => {
    const id = e.over?.id != null ? String(e.over.id) : null;
    const next = id ? sideOf(pointerOf(e), e.over.rect, vertical) : null;
    if (id !== overId) setOverId(id);
    if (next !== side) setSide(next);
    // Docking: only the links page, and only when it enters or leaves a zone.
    if (active?.type !== 'links' || vertical) return;
    const zone = dockZone(pointerOf(e), !!hold.current.ready);
    if (zone === hold.current.zone) return;
    clearHold();
    setDock(null);
    setArming(zone);
    if (zone) {
      const timer = setTimeout(() => { hold.current.ready = zone; setDock(zone); }, DOCK_HOLD_MS);
      hold.current = { zone, ready: null, timer };
    }
  };
  const reset = () => {
    clearHold();
    setActiveId(null); setOverId(null); setSide(null); setArming(null); setDock(null);
  };

  const end = (e) => {
    const { active: a, over } = e;
    const aimed = over ? sideOf(pointerOf(e), over.rect, vertical) : null;
    const docked = hold.current.ready;   // the ref: never a render behind
    reset();
    if (docked) { onDock(a.id, docked); return; }
    if (!over || a.id === over.id) return;
    const id = String(over.id);
    if (id.startsWith('free:')) onDrop(a.id, id.slice(5), 'free');
    else if (id.startsWith('row:')) onDrop(a.id, id.slice(4) || null, 'row');
    else onDrop(a.id, id, aimed);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={({ active: a }) => setActiveId(a.id)}
      onDragMove={track}
      onDragOver={track}
      onDragEnd={end}
      onDragCancel={reset}
    >
      <DndState.Provider value={{ activeId, overId, side, dock, arming }}>
        {children}
      </DndState.Provider>
      <DragOverlay dropAnimation={null}>
        {active ? (
          <div className={`ple-drag-chip${dock ? ' is-dock' : ''}`}>
            <RxDragHandleDots2 size={16} />
            {dock
              ? t(dock === 'left' ? 'profile.layout.dockLeft' : 'profile.layout.dockRight')
              : arming
                ? <>{labelFor(active)} <small>{t('profile.layout.dockHold')}</small></>
                : labelFor(active)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * The side of the grid the links page is being held against: a bar that fills
 * over DOCK_HOLD_MS, then the full-height column it will become on release.
 */
export function DockGuide() {
  const { arming, dock } = useContext(DndState);
  const edge = dock || arming;
  if (!edge) return null;
  return (
    <div
      className={`ple-dock ple-dock--${edge}${dock ? ' is-ready' : ''}`}
      style={{ '--ple-dock-ms': `${DOCK_HOLD_MS}ms` }}
      aria-hidden="true"
    />
  );
}

/**
 * The line between two rows (or after the last), as a drop target: whatever
 * lands here becomes a new full-width row. Takes no room in the grid; its hit
 * area sits in the gap above the row it starts, and it only shows while
 * something is being dragged.
 */
export function RowGap({ beforeId }) {
  const { t } = useTranslation();
  const { activeId, overId } = useContext(DndState);
  const id = `row:${beforeId || ''}`;
  const { setNodeRef } = useDroppable({ id });
  return (
    <div className="ple-rowgap">
      <div
        ref={setNodeRef}
        className={`ple-rowgap-hit${activeId ? ' is-active' : ''}${overId === id ? ' is-over' : ''}`}
      >
        {overId === id ? <span>{t('profile.layout.newRow')}</span> : null}
      </div>
    </div>
  );
}

/**
 * The empty columns at the end of a row, as a drop target: whatever lands here
 * takes exactly that space beside `afterId`.
 */
export function FreeCell({ afterId, span }) {
  const { t } = useTranslation();
  const { activeId, overId } = useContext(DndState);
  const id = `free:${afterId}`;
  const { setNodeRef } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`ple-free${activeId ? ' is-active' : ''}${overId === id ? ' is-over' : ''}`}
      style={{ gridColumn: `span ${span}` }}
    >
      {activeId ? t('profile.layout.dropHere') : null}
    </div>
  );
}

/**
 * The frame around one real section in edit mode: grip, earlier/later arrows,
 * hide, properties, and a handle on the right edge that sets the width in grid
 * columns. `sideColumn` = the links page as a column beside the grid: it can
 * be dragged INTO the grid, but nothing drops onto it, and it has no arrows or
 * width there.
 */
export function EditableSection({
  section, label, kind, playlists = [], sideColumn = false, mobile = false, className = '', isFirst = false, isLast = false,
  onPatch, onMoveEarlier, onMoveLater, onRemove, children,
}) {
  const { t } = useTranslation();
  const def = SECTION_DEFS[section.type];
  const { activeId, overId, side, dock } = useContext(DndState);
  const [open, setOpen] = useState(false);
  const { setNodeRef: dragRef, listeners, attributes } = useDraggable({ id: section.id });
  const { setNodeRef: dropRef } = useDroppable({ id: section.id, disabled: sideColumn });
  const frameRef = useRef(null);
  const setFrameRef = useCallback((el) => { frameRef.current = el; dropRef(el); }, [dropRef]);

  // A section with nothing to show (no shorts yet, a trailer-less channel...)
  // would be an empty frame, impossible to grab. Measured rather than guessed,
  // since most sections decide for themselves whether to render.
  const bodyRef = useRef(null);
  const [empty, setEmpty] = useState(false);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setEmpty(el.offsetHeight < 4));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── width: drag the right edge, snapping to grid columns ──
  const [resizing, setResizing] = useState(false);
  const startResize = (e) => {
    const frame = frameRef.current;
    const grid = frame?.closest('.pov-grid');
    if (!frame || !grid) return;
    e.preventDefault();
    e.stopPropagation();
    const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
    const col = (grid.clientWidth - gap * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
    const left = frame.getBoundingClientRect().left;
    let last = section.span;
    setResizing(true);
    const onMove = (ev) => {
      const span = clampSpan((ev.clientX - left + gap) / (col + gap));
      if (span !== last) { last = span; onPatch({ span }); }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setResizing(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const dragging = activeId === section.id;
  const target = !!activeId && !dragging && !dock && overId === section.id;

  return (
    <div
      ref={setFrameRef}
      className={[
        'ple-frame',
        className,
        dragging ? 'is-dragging' : '',
        target && side ? `is-target is-target--${side}` : '',
        open ? 'is-open' : '',
        resizing ? 'is-resizing' : '',
      ].filter(Boolean).join(' ')}
      data-section={section.type}
    >
      <div className="ple-toolbar">
        <button
          ref={dragRef}
          type="button"
          className="ple-icon ple-grip"
          title={t('profile.layout.drag')}
          aria-label={t('profile.layout.drag')}
          {...listeners}
          {...attributes}
        >
          <RxDragHandleDots2 size={17} />
        </button>
        <span className="ple-tag">
          {label}
          {kind ? <small>{kind}</small> : null}
          {section.hidden ? <em className="ple-badge">{t('profile.layout.hiddenBadge')}</em> : null}
        </span>
        {!sideColumn ? (
          <>
            <button
              type="button"
              className="ple-icon"
              onClick={onMoveEarlier}
              disabled={isFirst}
              title={t('profile.layout.moveUp')}
              aria-label={t('profile.layout.moveUp')}
            >
              <FiChevronUp size={16} />
            </button>
            <button
              type="button"
              className="ple-icon"
              onClick={onMoveLater}
              disabled={isLast}
              title={t('profile.layout.moveDown')}
              aria-label={t('profile.layout.moveDown')}
            >
              <FiChevronDown size={16} />
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="ple-icon"
          onClick={() => onPatch({ hidden: !section.hidden })}
          title={section.hidden ? t('profile.layout.show') : t('profile.layout.hide')}
          aria-label={section.hidden ? t('profile.layout.show') : t('profile.layout.hide')}
        >
          {section.hidden ? <FiEyeOff size={16} /> : <FiEye size={16} />}
        </button>
        <button
          type="button"
          className={`ple-icon ple-gear${open ? ' on' : ''}`}
          onClick={() => setOpen((v) => !v)}
          title={t('profile.layout.settings')}
          aria-label={t('profile.layout.settings')}
          aria-expanded={open}
        >
          <FiSettings size={15} />
        </button>
        {/* Removing a playlist section is a desktop-layout change; on the
            phone the eye hides it instead. */}
        {def.multi && !mobile ? (
          <button
            type="button"
            className="ple-icon ple-icon--remove"
            onClick={onRemove}
            title={t('profile.layout.remove')}
            aria-label={t('profile.layout.remove')}
          >
            <FiTrash2 size={15} />
          </button>
        ) : null}

        {open ? (
          <PropertiesPopover label={label} onClose={() => setOpen(false)}>
            <SectionSettings section={section} playlists={playlists} onPatch={onPatch} mobile={mobile} />
          </PropertiesPopover>
        ) : null}
      </div>

      {/* Editing, not browsing: a click on a card, link or button inside the
          section must not open it (or play it, or follow it). The frame's own
          controls sit outside this box. Iframes (the links page) get
          pointer-events:none in the stylesheet, as their clicks never reach here. */}
      <div
        ref={bodyRef}
        className="ple-body"
        onClickCapture={swallow}
        onAuxClickCapture={swallow}
      >
        {children}
      </div>
      {empty ? <div className="ple-empty">{t('profile.layout.emptySection')}</div> : null}

      {!sideColumn && !mobile ? (
        <div
          className="ple-resize"
          onPointerDown={startResize}
          title={t('profile.layout.resize')}
          aria-hidden="true"
        >
          {resizing ? <span className="ple-resize-label">{section.span}/{GRID_COLUMNS}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Hidden sections, below the grid while editing. They are out of the grid so
 * the edit view lays out exactly like the page visitors get; the eye puts one
 * back where it was in the order.
 */
export function HiddenTray({ sections, labelFor, onShow }) {
  const { t } = useTranslation();
  if (!sections.length) return null;
  return (
    <div className="ple-tray">
      <span className="ple-tray-title">{t('profile.layout.hiddenTitle')}</span>
      <div className="ple-tray-list">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            className="ple-chip"
            onClick={() => onShow(s.id)}
            title={t('profile.layout.show')}
          >
            <FiEyeOff size={14} /> {labelFor(s)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Sticky bar over the Overview while editing. */
export function LayoutEditBar({
  dirty, saving, onSave, onCancel, onReset, addablePlaylists = [], onAddPlaylist, onTour,
  device = 'desktop', onDevice = null, canUndo = false, canRedo = false, onUndo, onRedo,
}) {
  const { t } = useTranslation();
  return (
    <div className="ple-bar">
      <div className="ple-titles">
        <h3>
          {t('profile.layout.title')}
          <button
            type="button"
            className="ple-icon ple-tour-btn"
            onClick={onTour}
            title={t('profile.layout.tour.open')}
            aria-label={t('profile.layout.tour.open')}
          >
            <FiHelpCircle size={16} />
          </button>
        </h3>
        <p>{device === 'mobile' ? t('profile.layout.mobileHint') : t('profile.layout.hint')}</p>
      </div>
      <div className="ple-buttons">
        {/* No switch on a phone: there is only the phone layout to edit. */}
        {onDevice ? (
          <Segmented
            value={device}
            onChange={onDevice}
            options={[
              { value: 'desktop', label: t('profile.layout.deviceDesktop'), icon: <FiMonitor size={14} /> },
              { value: 'mobile', label: t('profile.layout.deviceMobile'), icon: <FiSmartphone size={14} /> },
            ]}
          />
        ) : null}
        {addablePlaylists.length > 0 ? (
          <label className="ple-add">
            <FiPlus size={15} />
            <select value="" onChange={(e) => onAddPlaylist(e.target.value)} aria-label={t('profile.layout.addPlaylist')}>
              <option value="">{t('profile.layout.addPlaylist')}</option>
              {addablePlaylists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        ) : null}
        <div className="ple-history">
          <button
            type="button"
            className="ple-icon"
            onClick={onUndo}
            disabled={!canUndo || saving}
            title={t('profile.layout.undoTitle')}
            aria-label={t('profile.layout.undo')}
          >
            <FiRotateCcw size={16} />
          </button>
          <button
            type="button"
            className="ple-icon"
            onClick={onRedo}
            disabled={!canRedo || saving}
            title={t('profile.layout.redoTitle')}
            aria-label={t('profile.layout.redo')}
          >
            <FiRotateCw size={16} />
          </button>
        </div>
        <button type="button" className="ple-btn" onClick={onReset} disabled={saving}>
          {device === 'mobile' ? t('profile.layout.matchDesktop') : t('profile.layout.reset')}
        </button>
        <button type="button" className="ple-btn" onClick={onCancel} disabled={saving}>
          {t('common.actions.cancel')}
        </button>
        <button type="button" className={`ple-btn ple-btn--primary${dirty ? ' dirty' : ''}`} onClick={onSave} disabled={saving}>
          {saving ? t('profile.layout.saving') : t('profile.layout.save')}
        </button>
      </div>
    </div>
  );
}
