import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePostCollaborators } from '../../lib/collabs';
import { Icon } from '../v2/Icon';
import './WatchCollaborators.scss';

/**
 * In the watch page's meta line: "· with @fan" for a collab post whose co-creator
 * accepted (lib/collabs.js). Nothing while loading, for a solo post, or for a
 * pending or declined invite.
 */
export default function WatchCollaborators({ author, permlink }) {
  const { t } = useTranslation();
  const list = usePostCollaborators(author, permlink);
  if (!list.length) return null;
  return (
    <>
      <span aria-hidden="true">·</span>
      <span className="wv2-collab">
        <Icon name="group" size={14} />
        {t('social.collab.withLabel')}
        {list.map((c, i) => (
          <Fragment key={c.account}>
            {i > 0 && ', '}
            <Link to={`/@${c.account}`}>@{c.account}</Link>
          </Fragment>
        ))}
      </span>
    </>
  );
}
