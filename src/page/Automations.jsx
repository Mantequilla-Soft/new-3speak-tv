import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Banner, Button, Card, ChoiceCard, Dialog, EmptyState, Icon, StatusPill, Toggle } from '../components/v2/ui';
import Skeleton from '../components/Wallet/Skeleton';
import { useAppStore } from '../lib/store';
import { automationsEnabledFor } from '../utils/config';
import { deleteAutomation, getAutomationRuns, getAutomations, restoreProCheck, skipProCheck, updateAutomation } from '../lib/automations';
import { addThreespeakToPostingAuth, waitForThreespeakPostingAuth } from '../utils/postingAuthority';
import { getCurrentProvider, Providers } from '../hive-api/aioha';
import { countSteps, starters } from '../components/Automations/designer';
import './Automations.scss';

// The designer (and its stylesheet) loads only when a workflow is opened.
const AutomationEditor = lazy(() => import('../components/Automations/AutomationEditor'));

// 🤖 /automations: a Pro creator's own workflows (closed beta). The list with an
// on/off switch and the runs of each, and the editor at /automations/:id
// (/automations/new starts from a starter). The server does the work:
// server/automations.cjs.

const RUN_TONE = { done: 'cyan', failed: 'accent', waiting: 'muted', queued: 'muted', running: 'muted', cancelled: 'muted' };

/** A 3speak.tv link as a path on this site (preview, a fork), so it stays here. */
const sitePath = (url) => String(url || '').replace(/^https:\/\/3speak\.tv/, '');

function when(iso, lang) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; }
}

function RunsDialog({ workflow, onClose }) {
  const { t, i18n } = useTranslation();
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    getAutomationRuns(workflow.id).then((d) => alive && setRuns(d.runs)).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [workflow.id]);
  return (
    <Dialog open onClose={onClose} title={t('automations.runs.title', { name: workflow.name })} closeLabel={t('automations.editor.close')} width={560}>
      {error && <Banner tone="warn">{error}</Banner>}
      {!runs && !error && <Skeleton rows={3} />}
      {runs && !runs.length && <EmptyState icon="history" title={t('automations.runs.empty')}>{t('automations.runs.emptyHint')}</EmptyState>}
      {runs && runs.length > 0 && (
        <ul className="aut-runs">
          {runs.map((r) => {
            const steps = Object.values(r.steps);
            return (
              <li key={r.id} className="aut-runs__row">
                <div className="aut-runs__head">
                  <StatusPill tone={RUN_TONE[r.status] || 'muted'} caps={false}>{t(`automations.runs.status.${r.status}`)}</StatusPill>
                  <span className="aut-runs__when">{when(r.createdAt, i18n.language)}</span>
                </div>
                <a className="aut-runs__post" href={sitePath(r.post.url)}>{r.post.title || `@${r.post.author}/${r.post.permlink}`}</a>
                <span className="aut-runs__meta">
                  {t('automations.runs.steps', { done: steps.filter((s) => s.status === 'done').length, count: steps.length })}
                  {r.attempts > 1 && ` · ${t('automations.runs.attempts', { count: r.attempts })}`}
                </span>
                {r.error && <span className="aut-runs__err">{r.error}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}

function WorkflowCard({ workflow, onToggle, onEdit, onRuns, onDelete, busy }) {
  const { t, i18n } = useTranslation();
  const event = workflow.definition.properties.event;
  return (
    <Card className={`aut-card${workflow.enabled ? ' is-on' : ''}`} dense>
      <div className="aut-card__top">
        <div className="aut-card__text">
          <b className="aut-card__name">{workflow.name}</b>
          <span className="aut-card__when"><Icon name="flag" size={14} />{t(`automations.events.${event}.label`)}</span>
        </div>
        <Toggle checked={workflow.enabled} onChange={onToggle} disabled={busy} label={t('automations.editor.enabled')} />
      </div>
      <div className="aut-card__meta">
        <span>{t('automations.list.steps', { count: countSteps(workflow.definition.sequence) })}</span>
        {workflow.lastRun && (
          <span>
            {t('automations.list.lastRun')}{' '}
            <StatusPill tone={RUN_TONE[workflow.lastRun.status] || 'muted'} caps={false}>{t(`automations.runs.status.${workflow.lastRun.status}`)}</StatusPill>{' '}
            {when(workflow.lastRun.at, i18n.language)}
          </span>
        )}
      </div>
      {workflow.enabled && workflow.problem && <Banner tone="warn">{t(`automations.problems.${workflow.problem}`)}</Banner>}
      <div className="aut-card__actions">
        <Button size={32} icon="edit" onClick={onEdit}>{t('automations.list.edit')}</Button>
        <Button size={32} variant="ghost" icon="history" onClick={onRuns}>{t('automations.list.runs')}</Button>
        <Button size={32} variant="ghost" icon="delete" onClick={onDelete} className="aut-card__delete">{t('automations.list.delete')}</Button>
      </div>
    </Card>
  );
}

function StarterPicker({ catalog, onPick, onClose }) {
  const { t } = useTranslation();
  return (
    <div className="aut-starters">
      <div className="aut-page__header">
        <div>
          <h1>{t('automations.starters.title')}</h1>
          <p className="aut-page__sub">{t('automations.starters.sub')}</p>
        </div>
        <Button variant="ghost" size={36} icon="arrow_back" onClick={onClose}>{t('automations.editor.back')}</Button>
      </div>
      <div className="aut-starters__grid" role="radiogroup">
        {starters(catalog, t).map((s) => (
          <ChoiceCard key={s.id} icon={s.id === 'blank' ? 'add' : 'auto_awesome'} title={t(`automations.starters.${s.id}.title`)}
            sub={t(`automations.starters.${s.id}.sub`)}
            onClick={() => onPick({ name: s.id === 'blank' ? '' : t(`automations.starters.${s.id}.title`), definition: { properties: { event: s.event }, sequence: s.sequence } })} />
        ))}
      </div>
    </div>
  );
}

export default function Automations() {
  const { t } = useTranslation();
  const { user, authenticated } = useAppStore();
  const { id } = useParams();
  const navigate = useNavigate();
  const allowed = automationsEnabledFor(user);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState('');
  const [runsOf, setRunsOf] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [start, setStart] = useState(null);
  const [granting, setGranting] = useState(false);

  const load = useCallback(() => {
    return getAutomations().then((d) => { setError(null); setData(d); }).catch((e) => setError({ code: e.code || (e.status === 401 ? 'sign_in' : null), message: e.message, canSkip: e.canSkip }));
  }, []);
  useEffect(() => { if (authenticated && allowed) load(); }, [authenticated, allowed, user, load]);

  const grant = async () => {
    const signWindow = getCurrentProvider() === Providers.HiveSigner ? window.open('', '_blank') : undefined;
    setGranting(true);
    try {
      await addThreespeakToPostingAuth(user, { signWindow });
      if (await waitForThreespeakPostingAuth(user, true)) setData((d) => d && { ...d, grant: true });
    } catch (e) {
      setError({ message: e.message });
    } finally {
      setGranting(false);
    }
  };

  // A new automation always starts at the starters.
  const startNew = () => { setStart(null); navigate('/automations/new'); };

  // Tester accounts without Pro may skip the Pro check (the server keeps it per account).
  const [skipping, setSkipping] = useState(false);
  const setProSkip = async (on) => {
    setSkipping(true);
    try {
      await (on ? skipProCheck() : restoreProCheck());
      if (!on) setData(null);
      await load();
    } catch (e) {
      setError({ message: e.message });
    } finally {
      setSkipping(false);
    }
  };

  const replace = (w) => setData((d) => {
    const has = d.workflows.some((x) => x.id === w.id);
    return { ...d, workflows: has ? d.workflows.map((x) => (x.id === w.id ? w : x)) : [...d.workflows, w] };
  });

  const toggle = async (w, on) => {
    setBusyId(w.id);
    try {
      replace((await updateAutomation(w.id, { enabled: on })).workflow);
    } catch (e) {
      setError({ message: e.code ? t(`automations.problems.${e.code}`, { defaultValue: e.message }) : e.message });
    } finally {
      setBusyId('');
    }
  };

  const remove = async () => {
    const w = removing;
    setRemoving(null);
    try {
      await deleteAutomation(w.id);
      setData((d) => ({ ...d, workflows: d.workflows.filter((x) => x.id !== w.id) }));
    } catch (e) {
      setError({ message: e.message });
    }
  };

  if (!authenticated || !user) {
    return <div className="aut-page"><Banner tone="info">{t('automations.gate.signIn')}</Banner></div>;
  }
  // Closed beta: anyone else gets the page a missing route would show.
  if (!allowed) {
    return <div className="aut-page"><EmptyState icon="lock" title={t('automations.gate.closedTitle')}>{t('automations.gate.closed')}</EmptyState></div>;
  }
  if (error?.code === 'pro_required') {
    return (
      <div className="aut-page">
        <EmptyState icon="workspace_premium" title={t('automations.gate.proTitle')}
          action={(
            <div className="aut-page__actions">
              <Button as={Link} to={`/wallet/${user}#pro`} variant="primary" icon="workspace_premium">{t('automations.gate.getPro')}</Button>
              {error.canSkip && <Button icon="science" onClick={() => setProSkip(true)} loading={skipping}>{t('automations.gate.skipPro')}</Button>}
            </div>
          )}>
          {t('automations.gate.pro')}
          {error.canSkip && <><br />{t('automations.gate.skipProHint')}</>}
        </EmptyState>
      </div>
    );
  }
  if (error && ['not_in_beta', 'unavailable', 'sign_in'].includes(error.code)) {
    return <div className="aut-page"><EmptyState icon="lock" title={t('automations.gate.closedTitle')}>{t(`automations.gate.${error.code === 'sign_in' ? 'signIn' : error.code === 'unavailable' ? 'unavailable' : 'closed'}`)}</EmptyState></div>;
  }
  if (!data) {
    return <div className="aut-page">{error ? <Banner tone="warn">{error.message}</Banner> : <Skeleton rows={3} />}</div>;
  }

  const editing = id && id !== 'new' ? data.workflows.find((w) => w.id === id) : null;
  if (id && id !== 'new' && !editing) {
    return <div className="aut-page"><EmptyState icon="search_off" title={t('automations.list.notFound')} action={<Button as={Link} to="/automations">{t('automations.editor.back')}</Button>} /></div>;
  }
  if (id === 'new' && !start) {
    return <div className="aut-page"><StarterPicker catalog={data.catalog} onPick={setStart} onClose={() => navigate('/automations')} /></div>;
  }
  if (id) {
    return (
      <div className="aut-page is-editor">
        <Suspense fallback={<div className="v2-skeleton aut-page__loading" aria-hidden="true" />}>
          <AutomationEditor
            key={editing?.id || 'new'}
            catalog={data.catalog}
            workflow={editing}
            start={start}
            grant={data.grant}
            onGrant={grant}
            onSaved={(w) => { replace(w); if (!editing) navigate(`/automations/${w.id}`, { replace: true }); }}
            onClose={() => navigate('/automations')}
          />
        </Suspense>
      </div>
    );
  }

  const full = data.workflows.length >= data.maxWorkflows;
  return (
    <div className="aut-page">
      <div className="aut-page__header">
        <div>
          <h1>{t('automations.title')} <StatusPill tone="cyan">{t('automations.beta')}</StatusPill></h1>
          <p className="aut-page__sub">{t('automations.subtitle')}</p>
        </div>
        <Button variant="primary" icon="add" disabled={full} onClick={startNew}>{t('automations.list.new')}</Button>
      </div>
      {error && <Banner tone="warn">{error.message}</Banner>}
      {data.proSkipped && (
        <Banner tone="info" icon="science" action={<Button size={32} onClick={() => setProSkip(false)} loading={skipping}>{t('automations.gate.restorePro')}</Button>}>
          {t('automations.gate.proSkipped')}
        </Banner>
      )}
      {!data.grant && (
        <Banner tone="warn" action={<Button size={32} onClick={grant} loading={granting}>{t('automations.grant.button')}</Button>}>
          {t('automations.grant.needed')}
        </Banner>
      )}
      {data.workflows.length === 0 ? (
        <EmptyState icon="account_tree" title={t('automations.list.emptyTitle')}
          action={<Button variant="primary" icon="add" onClick={startNew}>{t('automations.list.new')}</Button>}>
          {t('automations.list.empty')}
        </EmptyState>
      ) : (
        <div className="aut-list">
          {data.workflows.map((w) => (
            <WorkflowCard key={w.id} workflow={w} busy={busyId === w.id}
              onToggle={(on) => toggle(w, on)}
              onEdit={() => navigate(`/automations/${w.id}`)}
              onRuns={() => setRunsOf(w)}
              onDelete={() => setRemoving(w)} />
          ))}
        </div>
      )}
      <p className="aut-page__foot">{t('automations.howItWorks', { minutes: data.intervalMin })}</p>
      {runsOf && <RunsDialog workflow={runsOf} onClose={() => setRunsOf(null)} />}
      {removing && (
        <Dialog open onClose={() => setRemoving(null)} title={t('automations.list.deleteTitle', { name: removing.name })} closeLabel={t('automations.editor.close')}
          footer={(
            <>
              <Button onClick={() => setRemoving(null)}>{t('automations.list.cancel')}</Button>
              <Button variant="danger" icon="delete" onClick={remove}>{t('automations.list.delete')}</Button>
            </>
          )}>
          <p className="aut-note">{t('automations.list.deleteBody')}</p>
        </Dialog>
      )}
    </div>
  );
}
