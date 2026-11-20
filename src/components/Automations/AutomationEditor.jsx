import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SequentialWorkflowDesigner, wrapDefinition, useRootEditor, useStepEditor } from 'sequential-workflow-designer-react';
import { StepsDesignerExtension } from 'sequential-workflow-designer';
import 'sequential-workflow-designer/css/designer.css';
import { Banner, Button, Dialog, Field, Icon, StatusPill, Toggle } from '../v2/ui';
import { cx } from '../v2/helpers';
import { createAutomation, testAutomation, updateAutomation } from '../../lib/automations';
import { conditionProblem, emptyDefinition, IF_TYPE, placeholdersFor, propertyProblem, stepIconUrl, stepProblem, toolboxGroups } from './designer';
import TemplatePicker from './TemplatePicker';
import './AutomationEditor.scss';

// 🤖 The workflow editor: Sequential Workflow Designer with 3Speak's events,
// tasks and look. The designer draws the flow (drag from the toolbox, branches,
// undo, zoom); the side panel is ours: the event when nothing is selected
// (RootEditor), the selected step's properties otherwise (StepEditor). Both
// panels render in the designer's own React root, so they get what they need
// as props and through the designer's hooks, never from router context.

const fieldLabel = (t, id) => t(`automations.fields.${id}`);

// The event picker's groups, in this order (labels in automations.eventGroups.*).
const EVENT_GROUPS = [
  ['channel', ['video_published', 'short_published', 'video_imported', 'podcast_published', 'audio_published', 'stream_started', 'text_post_published']],
  ['wallet', ['tip_received', 'boost_received', 'power_up']],
  ['polls', ['poll_ended', 'stream_poll_ended']],
  ['others', ['someone_posted']],
];
const ACCOUNT_RE = /^[a-z][a-z0-9.-]{2,15}$/;

function PlaceholderChips({ catalog, event, onPick }) {
  const { t } = useTranslation();
  return (
    <div className="aut-chips" aria-label={t('automations.editor.placeholders')}>
      {placeholdersFor(catalog, event).map((p) => (
        <button key={p} type="button" className="aut-chip" onClick={() => onPick(`{${p}}`)} title={t(`automations.placeholders.${p}`)}>{`{${p}}`}</button>
      ))}
    </div>
  );
}

/** One task property, by its catalog type. */
// A choice's words: the catalog can name its options itself (the narration
// voices: a name and whether it is a female or male voice), else the locale.
function choiceLabel(spec, option, t) {
  const own = spec.labels?.[option];
  if (own) return own.gender ? `${own.name} (${t(`automations.voiceGender.${own.gender}`)})` : own.name;
  return t(`automations.choices.${option}`);
}

function PropertyField({ type, name, spec, value, onChange, readOnly }) {
  const { t, i18n } = useTranslation();
  const [tagText, setTagText] = useState(() => (Array.isArray(value) ? value.join(' ') : ''));
  const label = t(`automations.tasks.${type}.props.${name}`);
  const hintKey = `automations.tasks.${type}.hints.${name}`;
  const hint = i18n.exists(hintKey) ? t(hintKey) : undefined;
  const problem = propertyProblem(spec, value);
  const error = problem && problem !== 'required' ? t(`automations.problems.${problem}`) : undefined;

  if (spec.type === 'boolean') {
    return (
      <div className="aut-toggle-row">
        <div><b>{label}</b>{hint && <span>{hint}</span>}</div>
        <Toggle checked={!!value} onChange={onChange} label={label} disabled={readOnly} />
      </div>
    );
  }
  if (spec.type === 'template') {
    return (
      <Field label={label} hint={hint} error={error} as="textarea" rows={spec.max > 300 ? 4 : 2} maxLength={spec.max}
        value={value || ''} readOnly={readOnly} onChange={(e) => onChange(e.target.value)} />
    );
  }
  if (spec.type === 'tags') {
    return (
      <Field label={label} hint={hint || t('automations.editor.tagsHint', { max: spec.max })} error={error} optional optionalLabel={t('automations.editor.optional')}
        value={tagText} readOnly={readOnly}
        onChange={(e) => {
          setTagText(e.target.value);
          onChange(e.target.value.split(/[\s,]+/).map((x) => x.toLowerCase().replace(/^#/, '')).filter(Boolean));
        }} />
    );
  }
  if (spec.type === 'choice') {
    return (
      <div className="v2-field">
        <label className="v2-eyebrow" htmlFor={`aut-prop-${name}`}>{label}</label>
        <select id={`aut-prop-${name}`} className="v2-input is-select" value={value} disabled={readOnly} onChange={(e) => onChange(e.target.value)}>
          {spec.options.map((o) => <option key={o} value={o}>{choiceLabel(spec, o, t)}</option>)}
        </select>
      </div>
    );
  }
  if (spec.type === 'number') {
    return (
      <Field label={label} hint={hint} error={error} type="number" inputMode="numeric" min={spec.min} max={spec.max}
        value={value ?? ''} readOnly={readOnly} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
    );
  }
  return (
    <Field label={label} hint={hint} error={error} type={spec.pattern === 'discord_webhook' ? 'url' : 'text'}
      value={value || ''} readOnly={readOnly} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
  );
}

/** The if-step: a field of the event, an operator for its kind, a value. */
function ConditionFields({ catalog, event, properties, setProperty, readOnly }) {
  const { t } = useTranslation();
  const fields = catalog.events[event]?.fields || [];
  const field = fields.find((f) => f.id === properties.field);
  const ops = field ? catalog.operators[field.type] : [];
  const problem = conditionProblem(catalog, event, properties);

  const pickField = (id) => {
    const next = fields.find((f) => f.id === id);
    setProperty('field', id);
    setProperty('op', catalog.operators[next.type][0]);
    setProperty('value', next.type === 'choice' ? next.options[0] : '');
  };

  return (
    <>
      <div className="v2-field">
        <label className="v2-eyebrow" htmlFor="aut-if-field">{t('automations.if.field')}</label>
        <select id="aut-if-field" className="v2-input is-select" value={field ? properties.field : ''} disabled={readOnly} onChange={(e) => pickField(e.target.value)}>
          {!field && <option value="">{t('automations.if.pickField')}</option>}
          {fields.map((f) => <option key={f.id} value={f.id}>{fieldLabel(t, f.id)}</option>)}
        </select>
      </div>
      {field && (
        <div className="v2-field">
          <label className="v2-eyebrow" htmlFor="aut-if-op">{t('automations.if.operator')}</label>
          <select id="aut-if-op" className="v2-input is-select" value={properties.op} disabled={readOnly} onChange={(e) => setProperty('op', e.target.value)}>
            {ops.map((op) => <option key={op} value={op}>{t(`automations.ops.${op}`)}</option>)}
          </select>
        </div>
      )}
      {field && field.type === 'choice' && (
        <div className="v2-field">
          <label className="v2-eyebrow" htmlFor="aut-if-value">{t('automations.if.value')}</label>
          <select id="aut-if-value" className="v2-input is-select" value={properties.value} disabled={readOnly} onChange={(e) => setProperty('value', e.target.value)}>
            {field.options.map((o) => <option key={o} value={o}>{t(`automations.choices.${o}`)}</option>)}
          </select>
        </div>
      )}
      {field && field.type !== 'choice' && (
        <Field label={field.type === 'number' ? t(`automations.if.units.${field.unit || 'count'}`) : t('automations.if.value')}
          type={field.type === 'number' ? 'number' : 'text'} inputMode={field.type === 'number' ? 'decimal' : undefined} min={0}
          step={field.unit === 'amount' ? '0.001' : '1'}
          value={properties.value ?? ''} readOnly={readOnly}
          error={problem === 'bad_value' && String(properties.value ?? '').trim() ? t('automations.problems.bad_value') : undefined}
          onChange={(e) => setProperty('value', e.target.value)} />
      )}
      <p className="aut-note">{t('automations.if.branchesNote')}</p>
    </>
  );
}

/** The accounts someone_posted watches: names as typed, kept as a list. */
function AccountsField({ value, onChange, readOnly, max }) {
  const { t } = useTranslation();
  const [text, setText] = useState(() => (value || []).join(' '));
  const list = text.split(/[\s,]+/).map((a) => a.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  const bad = list.find((a) => !ACCOUNT_RE.test(a));
  const error = bad ? t('automations.problems.bad_account_named', { name: bad })
    : list.length > max ? t('automations.problems.too_many_accounts', { max }) : undefined;
  return (
    <Field label={t('automations.editor.accounts')} hint={t('automations.editor.accountsHint', { max })} error={error}
      as="textarea" rows={2} value={text} readOnly={readOnly} spellCheck={false} placeholder="badadib"
      onChange={(e) => {
        setText(e.target.value);
        onChange([...new Set(e.target.value.split(/[\s,]+/).map((a) => a.trim().toLowerCase().replace(/^@/, '')).filter(Boolean))]);
      }} />
  );
}

/** On a phone the panels are bottom sheets: a handle and a Done button on top. */
function SheetHead({ onClose }) {
  const { t } = useTranslation();
  if (!onClose) return null;
  return (
    <div className="aut-sheet-head">
      <span className="aut-sheet-head__grab" aria-hidden="true" />
      <Button size={32} variant="ghost" onClick={onClose}>{t('automations.editor.done')}</Button>
    </div>
  );
}

function RootEditor({ catalog, onClose }) {
  const { t } = useTranslation();
  const { properties, setProperty, definition, isReadonly } = useRootEditor();
  const event = properties.event;
  const misfits = definition.sequence.length > 0;
  const known = new Set(EVENT_GROUPS.flatMap(([, ids]) => ids));
  const groups = [...EVENT_GROUPS, ['more', Object.keys(catalog.events).filter((id) => !known.has(id))]]
    .map(([g, ids]) => [g, ids.filter((id) => catalog.events[id])]).filter(([, ids]) => ids.length);
  return (
    <div className="aut-panel">
      <SheetHead onClose={onClose} />
      <h3 className="aut-panel__title"><Icon name="flag" size={18} />{t('automations.editor.whenTitle')}</h3>
      <div className="v2-field">
        <label className="v2-eyebrow" htmlFor="aut-event">{t('automations.editor.event')}</label>
        <select id="aut-event" className="v2-input is-select" value={event} disabled={isReadonly} onChange={(e) => setProperty('event', e.target.value)}>
          {groups.map(([g, ids]) => (
            <optgroup key={g} label={t(`automations.eventGroups.${g}`)}>
              {ids.map((id) => <option key={id} value={id}>{t(`automations.events.${id}.label`)}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      <p className="aut-note">{t(`automations.events.${event}.desc`)}</p>
      {catalog.events[event]?.accounts && (
        <AccountsField key={event} value={properties.accounts} readOnly={isReadonly} max={catalog.limits.accounts || 20}
          onChange={(list) => setProperty('accounts', list)} />
      )}
      {misfits && <p className="aut-note">{t('automations.editor.eventChangeNote')}</p>}
      <div className="aut-panel__section">
        <span className="v2-eyebrow">{t('automations.editor.placeholders')}</span>
        <ul className="aut-placeholder-list">
          {placeholdersFor(catalog, event).map((p) => <li key={p}><code>{`{${p}}`}</code> {t(`automations.placeholders.${p}`)}</li>)}
        </ul>
      </div>
      <p className="aut-note">{t('automations.editor.howTo')}</p>
    </div>
  );
}

function StepEditor({ catalog, onClose }) {
  const { t } = useTranslation();
  const { type, componentType, name, setName, properties, setProperty, definition, isReadonly, id } = useStepEditor();
  const event = definition.properties.event;
  const step = { id, type, componentType, properties };
  const problem = stepProblem(catalog, event, step, definition);
  const task = componentType === 'task' ? catalog.tasks[type] : null;
  const [focusKey, setFocusKey] = useState(() => (task ? Object.keys(task.props).find((k) => task.props[k].type === 'template') : null));

  return (
    <div className="aut-panel">
      <SheetHead onClose={onClose} />
      <h3 className="aut-panel__title">
        <Icon name={componentType === 'switch' ? 'call_split' : task?.icon || 'bolt'} size={18} />
        {componentType === 'switch' ? t('automations.if.label') : t(`automations.tasks.${type}.label`)}
      </h3>
      <p className="aut-note">{componentType === 'switch' ? t('automations.if.desc') : t(`automations.tasks.${type}.desc`)}</p>
      <Field label={t('automations.editor.stepName')} value={name} readOnly={isReadonly} maxLength={80} onChange={(e) => setName(e.target.value)} />
      {problem === 'task_not_for_event' && <Banner tone="warn">{t('automations.problems.task_not_for_event')}</Banner>}
      {problem === 'too_many_of_type' && <Banner tone="warn">{t('automations.problems.too_many_of_type')}</Banner>}
      {componentType === 'switch' && type === IF_TYPE && (
        <ConditionFields catalog={catalog} event={event} properties={properties} setProperty={setProperty} readOnly={isReadonly} />
      )}
      {task && Object.entries(task.props).map(([key, spec]) => (
        <div key={key} onFocus={() => spec.type === 'template' && setFocusKey(key)}>
          <PropertyField type={type} name={key} spec={spec} value={properties[key]} readOnly={isReadonly}
            onChange={(v) => setProperty(key, v)} />
        </div>
      ))}
      {task && focusKey && !isReadonly && (
        <div className="aut-panel__section">
          <span className="v2-eyebrow">{t('automations.editor.insert')}</span>
          <PlaceholderChips catalog={catalog} event={event} onPick={(p) => setProperty(focusKey, `${properties[focusKey] || ''}${p}`)} />
        </div>
      )}
    </div>
  );
}

/** Steps in the order they appear, with their branch depth, for the test results. */
function flatten(sequence, depth = 0, out = []) {
  for (const s of sequence) {
    out.push({ step: s, depth });
    if (s.branches) for (const b of Object.keys(s.branches)) flatten(s.branches[b], depth + 1, out);
  }
  return out;
}

function TestResult({ result, definition, onClose }) {
  const { t } = useTranslation();
  const rows = flatten(definition.sequence).filter(({ step }) => result.steps[step.id]);
  return (
    <Dialog open onClose={onClose} title={t('automations.test.title')} closeLabel={t('automations.editor.close')} width={560}>
      <p className="aut-note">
        {result.sample
          ? t('automations.test.sample')
          : t('automations.test.onPost', { title: result.post.title || `@${result.post.author}/${result.post.permlink}` })}
      </p>
      <p className="aut-note">{t('automations.test.nothingPosted')}</p>
      <ol className="aut-test">
        {rows.map(({ step, depth }) => {
          const r = result.steps[step.id];
          const out = r.result || {};
          return (
            <li key={step.id} className={cx('aut-test__row', `is-${r.status}`)} style={{ '--depth': depth }}>
              <div className="aut-test__head">
                <Icon name={step.componentType === 'switch' ? 'call_split' : 'check_circle'} size={16} />
                <b>{step.name}</b>
                {r.branch && <StatusPill tone="cyan" caps={false}>{t(`automations.if.branch.${r.branch}`)}</StatusPill>}
                {r.status === 'failed' && <StatusPill tone="accent" caps={false}>{t('automations.runs.status.failed')}</StatusPill>}
              </div>
              {out.text && <pre className="aut-test__text">{out.text}</pre>}
              {out.caption && <pre className="aut-test__text">{out.caption}</pre>}
              {out.would === 'post_short' && <span className="aut-note">{t('automations.test.shortDetail', { start: out.start, length: out.length })}</span>}
              {out.title && <pre className="aut-test__text">{out.title}</pre>}
              {out.on && <span className="aut-note">{out.weight ? t('automations.test.voteOn', { on: out.on, weight: out.weight }) : t('automations.test.reblogOn', { on: out.on })}</span>}
              {out.skipped && <span className="aut-note">{t(`automations.test.skipped.${out.skipped}`)}</span>}
              {r.error && <span className="aut-test__err">{r.error}</span>}
            </li>
          );
        })}
      </ol>
      {!rows.length && <p className="aut-note">{t('automations.test.noSteps')}</p>}
    </Dialog>
  );
}

/**
 * props: catalog, workflow (saved, or null for a new one), start (a new one's
 * { name, definition }), grant, onGrant() → Promise, onSaved(workflow), onClose()
 */
export default function AutomationEditor({ catalog, workflow, start, grant, onGrant, onSaved, onClose }) {
  const { t, i18n } = useTranslation();
  const [name, setName] = useState(workflow?.name || start?.name || '');
  const [definition, setDefinition] = useState(() => wrapDefinition(workflow?.definition || start?.definition || emptyDefinition()));
  const [enabled, setEnabled] = useState(!!workflow?.enabled);
  const [selectedStepId, setSelectedStepId] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [test, setTest] = useState(null);
  const [picking, setPicking] = useState(false);
  const [dirty, setDirty] = useState(!workflow);
  // On a phone the toolbox and the side panel start folded away, or they cover the flow.
  const [narrow] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 720px)').matches);
  const [toolboxCollapsed, setToolboxCollapsed] = useState(narrow);
  const [editorCollapsed, setEditorCollapsed] = useState(narrow);
  const event = definition.value.properties.event;

  const toolboxConfiguration = useMemo(() => ({
    groups: toolboxGroups(catalog, event, t),
    descriptionProvider: (step) => (step.type === IF_TYPE ? t('automations.if.desc') : t(`automations.tasks.${step.type}.desc`)),
  }), [catalog, event, t]);
  const stepsConfiguration = useMemo(() => ({ iconUrlProvider: stepIconUrl(catalog), isDuplicable: () => true }), [catalog]);
  const validatorConfiguration = useMemo(() => ({
    step: (step, _parent, def) => !stepProblem(catalog, def.properties.event, step, def),
    // An event about other accounts needs at least one of them.
    root: (def) => !!catalog.events[def.properties.event]
      && (!catalog.events[def.properties.event].accounts || (def.properties.accounts || []).length > 0),
  }), [catalog]);
  const extensions = useMemo(() => [StepsDesignerExtension.create({
    switch: { branchNameLabelResolver: (branch) => t(`automations.if.branch.${branch}`, { defaultValue: branch }) },
  })], [t]);
  // The designer's own words (toolbox, control bar, context menu).
  const designerText = useMemo(() => (key, fallback) => t(`automations.designer.${key}`, { defaultValue: fallback }), [t]);

  const onDefinitionChange = (next) => {
    setDefinition(next);
    setDirty(true);
    setError('');
    // A step dropped from the toolbox sheet: fold the sheet so the flow shows.
    if (narrow) setToolboxCollapsed(true);
  };
  // Phone: tapping a step opens its properties as a bottom sheet; closing the
  // sheet also unselects, so the next tap on the same step opens it again.
  const onSelect = (id) => {
    setSelectedStepId(id);
    if (narrow && id) { setEditorCollapsed(false); setToolboxCollapsed(true); }
  };
  const closeSheets = () => {
    setEditorCollapsed(true);
    setToolboxCollapsed(true);
    setSelectedStepId(null);
  };
  const sheetOpen = narrow && (!editorCollapsed || !toolboxCollapsed);
  // A template replaces what is on the canvas (the name too, while there is none).
  const applyTemplate = ({ name: tplName, definition: def }) => {
    setDefinition(wrapDefinition(def));
    if (!name.trim() && tplName) setName(tplName);
    setSelectedStepId(null);
    setDirty(true);
    setError('');
    setPicking(false);
  };
  const empty = definition.value.sequence.length === 0;

  const explain = (e) => {
    if (e.stepId) setSelectedStepId(e.stepId);
    const key = e.code && `automations.problems.${e.code}`;
    return key && i18n.exists(key) ? t(key, { max: catalog.limits.accounts || 20, name: '' }) : e.message;
  };

  const save = async (nextEnabled = enabled) => {
    if (!name.trim()) { setError(t('automations.problems.no_name')); return; }
    if (nextEnabled && !grant) { setError(t('automations.problems.no_grant')); return; }
    setBusy('save');
    setError('');
    try {
      const body = { name: name.trim(), definition: definition.value, enabled: nextEnabled };
      const { workflow: saved } = workflow ? await updateAutomation(workflow.id, body) : await createAutomation(body);
      setEnabled(saved.enabled);
      setDirty(false);
      onSaved(saved);
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy('');
    }
  };

  const runTest = async () => {
    setBusy('test');
    setError('');
    try {
      setTest(await testAutomation(definition.value));
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className={cx('aut-editor', narrow && 'is-narrow', narrow && !toolboxCollapsed && 'is-toolbox-open')}>
      <div className="aut-editor__bar">
        <Button variant="ghost" size={36} icon="arrow_back" onClick={onClose} aria-label={t('automations.editor.back')}>{t('automations.editor.back')}</Button>
        <input className="v2-input aut-editor__name" value={name} maxLength={80} placeholder={t('automations.editor.namePlaceholder')}
          aria-label={t('automations.editor.name')} onChange={(e) => { setName(e.target.value); setDirty(true); }} />
        <label className="aut-editor__switch">
          <span>{enabled ? t('automations.list.on') : t('automations.list.off')}</span>
          <Toggle checked={enabled} label={t('automations.editor.enabled')} disabled={!!busy || (!workflow && !enabled && empty)}
            onChange={(on) => (workflow && !dirty ? save(on) : setEnabled(on))} />
        </label>
        {/* Phones start from the templates on the New page; the canvas needs the room here. */}
        {!narrow && <Button size={36} variant="ghost" icon="auto_awesome" onClick={() => setPicking(true)} disabled={!!busy}>{t('automations.templates.button')}</Button>}
        <Button size={36} icon="science" onClick={runTest} loading={busy === 'test'} disabled={!!busy || empty}>{t('automations.editor.test')}</Button>
        <Button variant="primary" size={36} icon="save" onClick={() => save()} loading={busy === 'save'} disabled={!!busy || (!dirty && !!workflow)}>
          {t('automations.editor.save')}
        </Button>
      </div>
      {enabled && !grant && (
        <Banner tone="warn" action={<Button size={32} onClick={onGrant}>{t('automations.grant.button')}</Button>}>{t('automations.grant.needed')}</Banner>
      )}
      {error && <Banner tone="warn">{error}</Banner>}
      <div className="aut-editor__canvas">
        <SequentialWorkflowDesigner
          definition={definition}
          onDefinitionChange={onDefinitionChange}
          selectedStepId={selectedStepId}
          onSelectedStepIdChanged={onSelect}
          theme="3speak"
          stepsConfiguration={stepsConfiguration}
          validatorConfiguration={validatorConfiguration}
          toolboxConfiguration={toolboxConfiguration}
          extensions={extensions}
          i18n={designerText}
          controlBar
          contextMenu
          undoStackSize={20}
          isToolboxCollapsed={toolboxCollapsed}
          onIsToolboxCollapsedChanged={(c) => { setToolboxCollapsed(c); if (narrow && !c) setEditorCollapsed(true); }}
          isEditorCollapsed={editorCollapsed}
          onIsEditorCollapsedChanged={setEditorCollapsed}
          rootEditor={<RootEditor catalog={catalog} onClose={narrow ? closeSheets : undefined} />}
          stepEditor={<StepEditor catalog={catalog} onClose={narrow ? closeSheets : undefined} />}
        />
        {sheetOpen && <div className="aut-sheet-backdrop" onClick={closeSheets} aria-hidden="true" />}
        {empty && <div className="aut-editor__hint" aria-hidden="true"><Icon name="drag_pan" size={18} />{t('automations.editor.emptyHint')}</div>}
      </div>
      {test && <TestResult result={test} definition={definition.value} onClose={() => setTest(null)} />}
      {picking && (
        <Dialog open onClose={() => setPicking(false)} title={t('automations.templates.title')} closeLabel={t('automations.editor.close')} width={760}>
          {!empty && <Banner tone="info">{t('automations.templates.replaces')}</Banner>}
          <TemplatePicker catalog={catalog} onPick={applyTemplate} blank={false} />
        </Dialog>
      )}
    </div>
  );
}
