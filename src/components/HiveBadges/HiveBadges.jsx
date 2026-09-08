import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext, DragOverlay, useDraggable, useDroppable,
  PointerSensor, KeyboardSensor, useSensor, useSensors, pointerWithin,
} from '@dnd-kit/core';
import { IoClose } from 'react-icons/io5';
import { MdLock } from 'react-icons/md';
import { RxDragHandleDots2 } from 'react-icons/rx';
import { toastIn } from '../../utils/toast';
import { fetchHiveBadges, isThreeSpeakBadge, saveBadgeOrder } from '../../utils/hiveBadges';
import './HiveBadges.scss';

// Every toast from this module is headed "Profile"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Profile');

// Enough to show what a creator is known for without the badge row taking over
// the profile header. The rest live one click away.
const MAX_VISIBLE = 5;

// Badge artwork is arbitrary user-uploaded imagery, so a chip that fails to
// load falls back to a neutral tile rather than a broken-image glyph.
function BadgeImage({ badge, className }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className={`${className} ${className}--fallback`} aria-hidden="true" />;
  return (
    <img
      className={className}
      src={badge.image}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function BadgeRowBody({ badge }) {
  return (
    <>
      <BadgeImage badge={badge} className="hbadges-row-img" />
      <span className="hbadges-row-text">
        <span className="hbadges-row-name">{badge.name}</span>
        {badge.about ? <span className="hbadges-row-about">{badge.about}</span> : null}
      </span>
    </>
  );
}

// A badge the creator can drag. Each row is both the drag source and a drop
// target, so dropping onto a row inserts at that row's position.
function MovableRow({ badge }) {
  const { setNodeRef: dragRef, listeners, attributes, isDragging } = useDraggable({ id: badge.account });
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: badge.account });
  const ref = (node) => { dragRef(node); dropRef(node); };

  return (
    <div
      ref={ref}
      className={`hbadges-row hbadges-row--movable${isDragging ? ' dragging' : ''}${isOver ? ' over' : ''}`}
    >
      <span className="hbadges-grip" {...listeners} {...attributes} title="Drag to reorder">
        <RxDragHandleDots2 size={16} />
      </span>
      <BadgeRowBody badge={badge} />
    </div>
  );
}

function moveBadge(list, activeId, overId) {
  const from = list.findIndex((b) => b.account === activeId);
  const to = list.findIndex((b) => b.account === overId);
  if (from < 0 || to < 0 || from === to) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Full badge list, opened from "Show more"
 or "Arrange". Portalled to body so
 * the profile header's backdrop-filter and stacking context can't clip it.
 *
 * On your own profile it doubles as the editor: drag the movable badges into
 * the order you want them shown, and save it to your Hive account. 3Speak's
 * badges sit above the draggable block and can't be moved.
 */
function AllBadgesModal({ username, badges, canArrange, startArranging, onClose, onSaved }) {
  const pinned = badges.filter(isThreeSpeakBadge);
  const [arranging, setArranging] = useState(startArranging);
  const [draft, setDraft] = useState(() => badges.filter((b) => !isThreeSpeakBadge(b)));
  const [activeId, setActiveId] = useState(null);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const active = draft.find((b) => b.account === activeId);

  const save = async () => {
    setSaving(true);
    try {
      await saveBadgeOrder(username, draft.map((b) => b.account));
      onSaved([...pinned, ...draft]);
      toast.success('Badge order saved to your Hive profile');
      setArranging(false);
    } catch (err) {
      toast.error(err?.message || 'Could not save your badge order');
    } finally {
      setSaving(false);
    }
  };

  const rows = arranging ? draft : badges.filter((b) => !isThreeSpeakBadge(b));

  return createPortal(
    <div className="hbadges-overlay" onClick={onClose}>
      <div
        className="hbadges-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Badges held by @${username}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="hbadges-close" onClick={onClose} aria-label="Close">
          <IoClose size={22} />
        </button>
        <h3 className="hbadges-title">Badges</h3>
        <p className="hbadges-sub">
          {arranging
            ? 'Drag your badges into the order you want them shown.'
            : `${badges.length} ${badges.length === 1 ? 'badge' : 'badges'} earned by @${username} on Hive`}
        </p>

        <div className="hbadges-list">
          {/* Pinned block renders in both modes, so the order on screen always
              matches the order on the profile. */}
          {pinned.map((badge) => (
            arranging ? (
              <div key={badge.account} className="hbadges-row hbadges-row--pinned">
                <span className="hbadges-grip hbadges-grip--locked" title="Always shown first">
                  <MdLock size={13} />
                </span>
                <BadgeRowBody badge={badge} />
              </div>
            ) : (
              <a
                key={badge.account}
                className="hbadges-row"
                href={badge.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <BadgeRowBody badge={badge} />
              </a>
            )
          ))}

          {arranging ? (
            <DndContext
              sensors={sensors}
              collisionDetection={pointerWithin}
              onDragStart={(e) => setActiveId(e.active.id)}
              onDragCancel={() => setActiveId(null)}
              onDragEnd={({ active: a, over }) => {
                setActiveId(null);
                if (!over || over.id === a.id) return;
                setDraft((list) => moveBadge(list, a.id, String(over.id)));
              }}
            >
              {rows.map((badge) => <MovableRow key={badge.account} badge={badge} />)}
              <DragOverlay dropAnimation={null}>
                {active ? (
                  <div className="hbadges-row hbadges-row--overlay">
                    <BadgeRowBody badge={active} />
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          ) : (
            rows.map((badge) => (
              <a
                key={badge.account}
                className="hbadges-row"
                href={badge.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <BadgeRowBody badge={badge} />
              </a>
            ))
          )}
        </div>

        {canArrange && (
          <div className="hbadges-actions">
            {arranging ? (
              <>
                <button
                  type="button"
                  className="hbadges-btn"
                  onClick={() => {
                    setDraft(badges.filter((b) => !isThreeSpeakBadge(b)));
                    setArranging(false);
                  }}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button type="button" className="hbadges-btn hbadges-btn--primary" onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : 'Save order'}
                </button>
              </>
            ) : (
              <button type="button" className="hbadges-btn" onClick={() => setArranging(true)}>
                <RxDragHandleDots2 size={15} /> Arrange
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Hive badges held by a creator, shown above 3Speak's own badges on the
 * profile header.
 *
 * These are the PeakD-convention badges: a `badge-*` account following you
 * means you hold that badge (see utils/hiveBadges). 3Speak's own badges are
 * pinned to the front; the rest follow the order the creator saved to their
 * Hive account, and past the first few the row collapses behind "Show more".
 *
 * Renders nothing while loading or when the account holds no badges, so it
 * costs a profile with none exactly one row of nothing.
 *
 * Props:
 *   username    Hive account whose badges to show.
 *   canArrange  Viewer owns this profile, so they get the arrange controls.
 */
function HiveBadges({ username, canArrange = false }) {
  // Store WHICH profile the popup was opened for rather than a plain boolean:
  // navigating from one profile to another then closes it for free, with no
  // reset effect.
  const [popup, setPopup] = useState(null);
  const open = popup?.user === username ? popup : null;
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['hive-badges', username],
    queryFn: () => fetchHiveBadges(username),
    enabled: !!username,
    // Badges are awarded by hand and rarely change; an hour is generous.
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  const badges = data || [];
  if (!badges.length) return null;

  const visible = badges.slice(0, MAX_VISIBLE);
  const hidden = badges.length - visible.length;
  // Arranging lives in the popup, and "Show more" is how you get there. With
  // nothing hidden that chip would be a lie, so for the owner it becomes the
  // arrange entry point instead — one trailing chip either way, never two.
  const arrangeOnly = hidden === 0 && canArrange && badges.length > 1;

  return (
    <div className="hive-badges">
      {visible.map((badge) => (
        <a
          key={badge.account}
          className="hive-badge"
          href={badge.url}
          target="_blank"
          rel="noopener noreferrer"
          title={badge.about ? `${badge.name}\n${badge.about}` : badge.name}
        >
          <BadgeImage badge={badge} className="hive-badge-img" />
          <span className="hive-badge-name">{badge.name}</span>
        </a>
      ))}

      {(hidden > 0 || arrangeOnly) && (
        <button
          type="button"
          className="hive-badge hive-badge-more"
          onClick={() => setPopup({ user: username, arranging: arrangeOnly })}
          title={arrangeOnly
            ? 'Choose the order your badges appear in'
            : `Show all ${badges.length} badges`}
        >
          {arrangeOnly ? 'Arrange' : 'Show more'}
        </button>
      )}

      {open && (
        <AllBadgesModal
          username={username}
          badges={badges}
          canArrange={canArrange}
          startArranging={open.arranging}
          onClose={() => setPopup(null)}
          // Reflect the new order immediately: the write is on-chain and
          // hivemind takes a few seconds to serve it back.
          onSaved={(ordered) => queryClient.setQueryData(['hive-badges', username], ordered)}
        />
      )}
    </div>
  );
}

export default HiveBadges;
