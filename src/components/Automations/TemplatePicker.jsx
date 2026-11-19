import { useTranslation } from 'react-i18next';
import { ChoiceCard } from '../v2/ui';
import { DEFAULT_EVENT, TEMPLATE_GROUPS, templates } from './designer';

const GROUP_ICON = { videos: 'smart_display', audio: 'headphones', live: 'sensors', polls: 'ballot', thanks: 'volunteer_activism', others: 'group' };

/**
 * The ready-made workflows by group, plus "Start empty" when `blank` is set.
 * onPick({ name, definition }): a template's name is its title; empty starts unnamed.
 */
export default function TemplatePicker({ catalog, onPick, blank = true }) {
  const { t } = useTranslation();
  const list = templates(catalog, t);
  const pick = (tpl) => onPick({
    name: t(`automations.templates.items.${tpl.id}.title`),
    definition: { properties: { event: tpl.event }, sequence: tpl.sequence },
  });
  return (
    <div className="aut-templates">
      {TEMPLATE_GROUPS.map((g) => {
        const items = list.filter((tpl) => tpl.group === g);
        if (!items.length) return null;
        return (
          <section key={g} className="aut-templates__group">
            <h2 className="v2-eyebrow">{t(`automations.templates.groups.${g}`)}</h2>
            <div className="aut-templates__grid" role="radiogroup" aria-label={t(`automations.templates.groups.${g}`)}>
              {items.map((tpl) => (
                <ChoiceCard key={tpl.id} icon={GROUP_ICON[g]} title={t(`automations.templates.items.${tpl.id}.title`)}
                  sub={t(`automations.templates.items.${tpl.id}.sub`)} onClick={() => pick(tpl)} />
              ))}
            </div>
          </section>
        );
      })}
      {blank && (
        <section className="aut-templates__group">
          <h2 className="v2-eyebrow">{t('automations.templates.groups.own')}</h2>
          <div className="aut-templates__grid" role="radiogroup" aria-label={t('automations.templates.groups.own')}>
            <ChoiceCard icon="add" title={t('automations.templates.items.blank.title')} sub={t('automations.templates.items.blank.sub')}
              onClick={() => onPick({ name: '', definition: { properties: { event: DEFAULT_EVENT }, sequence: [] } })} />
          </div>
        </section>
      )}
    </div>
  );
}
