import { Fragment, useState } from 'react';
import {
  DndContext, DragOverlay, useDraggable, useDroppable,
  PointerSensor, KeyboardSensor, useSensor, useSensors, pointerWithin,
} from '@dnd-kit/core';
import { RxDragHandleDots2 } from 'react-icons/rx';
import { useTranslation } from 'react-i18next';
import { iconForSlug, layoutToRows, rowsToSections, SECTION_TYPES } from '../../utils/spotlight';

// Compact representation of a block for the arrange tiles.
function TileMini({ s }) {
  const { t } = useTranslation();
  if (s.type === 'link') {
    const Icon = iconForSlug(s.icon);
    return <><span className="ag-mini-ic"><Icon size={13} /></span><span className="ag-mini-lbl">{s.title || s.url || t('spotlight.sectionTypes.link')}</span></>;
  }
  if (s.type === 'header') return <span className="ag-mini-lbl ag-mini-hd">{s.text || t('spotlight.arrange.title')}</span>;
  if (s.type === 'image') return s.src
    ? <img className="ag-mini-thumb" src={s.src} alt="" />
    : <span className="ag-mini-lbl">{t('spotlight.sectionTypes.image')}</span>;
  if (s.type === 'video') return (
    <span className="ag-mini-vid">
      {s.thumbnail ? <img className="ag-mini-thumb" src={s.thumbnail} alt="" /> : <span className="ag-mini-lbl">{s.title || t('spotlight.arrange.video')}</span>}
      <span className="ag-mini-play">▶</span>
    </span>
  );
  if (s.type === 'embed') {
    const EIcon = (SECTION_TYPES.find((st) => st.type === 'embed') || SECTION_TYPES[0]).Icon;
    const label = s.source === 'hive-recent'
      ? (s.account ? t('spotlight.arrange.latestPostsBy', { account: s.account }) : t('spotlight.arrange.latestPosts'))
      : (s.title || s.siteName || t('spotlight.sectionTypes.embed'));
    return (
      <>
        {s.image && s.source !== 'hive-recent' ? <img className="ag-mini-thumb" src={s.image} alt="" /> : <span className="ag-mini-ic"><EIcon size={13} /></span>}
        <span className="ag-mini-lbl">{label}</span>
      </>
    );
  }
  const T = (SECTION_TYPES.find((st) => st.type === s.type) || SECTION_TYPES[0]).Icon;
  return <span className="ag-mini-lbl"><T size={13} /> {t(`spotlight.blockNames.${s.type}`, { defaultValue: s.type })}</span>;
}

function Tile({ s, selected, onSelect }) {
  const { t } = useTranslation();
  const { setNodeRef: dragRef, listeners, attributes, isDragging } = useDraggable({ id: s.id });
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: s.id });
  const ref = (n) => { dragRef(n); dropRef(n); };
  return (
    <div ref={ref}
      className={`ag-tile ag-tile--${s.type}${isDragging ? ' dragging' : ''}${isOver ? ' over' : ''}${selected ? ' selected' : ''}`}
      onClick={() => onSelect(selected ? null : s.id)}>
      <span className="ag-grip" {...listeners} {...attributes} title={t('spotlight.arrange.dragToArrange')} onClick={(e) => e.stopPropagation()}>
        <RxDragHandleDots2 size={15} />
      </span>
      <TileMini s={s} />
    </div>
  );
}

function RowSep({ id }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={`ag-sep${isOver ? ' over' : ''}`} />;
}

function moveBlock(sections, activeId, overId) {
  const byId = new Map(sections.map((s) => [s.id, s]));
  let rows = layoutToRows(sections).map((r) => r.map((s) => s.id));
  rows = rows.map((r) => r.filter((id) => id !== activeId)).filter((r) => r.length);

  if (overId.startsWith('nr:')) {
    const key = overId.slice(3);
    if (key === 'end') rows.push([activeId]);
    else {
      const ri = rows.findIndex((r) => r[0] === key);
      if (ri >= 0) rows.splice(ri, 0, [activeId]);
      else rows.push([activeId]);
    }
  } else {
    let placed = false;
    for (let ri = 0; ri < rows.length; ri += 1) {
      const pos = rows[ri].indexOf(overId);
      if (pos >= 0) {
        if (rows[ri].length < 3) rows[ri].splice(pos, 0, activeId);   // join the row → resize
        else rows.splice(ri + 1, 0, [activeId]);                       // row full → new row after
        placed = true;
        break;
      }
    }
    if (!placed) rows.push([activeId]);
  }

  const objRows = rows.map((r) => r.map((id) => byId.get(id)).filter(Boolean));
  return rowsToSections(objRows);
}

/**
 * The EDITOR's drag-to-arrange surface. Drag a block's grip onto another block to
 * put them in the SAME row (they auto-resize 2→half / 3→third, max 3); drop on a
 * line between rows to start a new full-width row. Click a tile to edit its content.
 * No size buttons — the size is inferred from where you drop.
 */
export default function ArrangeGrid({ sections, onChange, selectedId, onSelect, editor }) {
  const [activeId, setActiveId] = useState(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const rows = layoutToRows(sections);
  const active = sections.find((s) => s.id === activeId);

  if (!sections.length) return null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(e) => setActiveId(e.active.id)}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={({ active: a, over }) => {
        setActiveId(null);
        if (!over || over.id === a.id) return;
        onChange(moveBlock(sections, a.id, String(over.id)));
      }}
    >
      <div className={`ag${activeId ? ' dragging' : ''}`}>
        {rows.map((row) => (
          <Fragment key={row[0].id}>
            <RowSep id={`nr:${row[0].id}`} />
            <div className="ag-row">
              {row.map((s) => <Tile key={s.id} s={s} selected={s.id === selectedId} onSelect={onSelect} />)}
            </div>
            {/* Settings expand inline right under the block you clicked (hidden while dragging). */}
            {editor && !activeId && row.some((s) => s.id === selectedId) && (
              <div className="ag-editor">{editor}</div>
            )}
          </Fragment>
        ))}
        <RowSep id="nr:end" />
      </div>
      <DragOverlay dropAnimation={null}>
        {active ? <div className="ag-tile ag-overlay"><TileMini s={active} /></div> : null}
      </DragOverlay>
    </DndContext>
  );
}
