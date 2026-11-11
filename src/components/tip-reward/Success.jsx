import React, { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, Eyebrow } from '../v2/ui';
import './Success.scss';

// The confetti takes the theme's own accent and cyan (read from the tokens),
// so it never brings colors of its own.
function themeColors() {
  try {
    const css = getComputedStyle(document.documentElement);
    const list = ['--accent', '--cyan', '--on-media'].map((v) => css.getPropertyValue(v).trim()).filter((c) => /^#[0-9a-f]{3,8}$/i.test(c));
    return list.length ? list : undefined;
  } catch {
    return undefined;
  }
}

// `monthly`: the tip was the first of a monthly support (lib/recurringTip.js).
// The thank-you (design 19f): an accent success card with the amount in mono.
const Success = ({ amount, currency, recipient, monthly = false, onClose }) => {
  const { t } = useTranslation();
  useEffect(() => {
    const duration = 3000;
    const end = Date.now() + duration;
    const colors = themeColors();

    const frame = () => {
      confetti({
        particleCount: 2,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors
      });

      confetti({
        particleCount: 2,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    };

    frame();
  }, []);

  return (
    <div className="tip-success v2-success is-accent">
      {recipient && <Avatar src={`/img/u/${recipient}/avatar/small`} name={recipient} size={72} ring="accent" className="tip-success__avatar" />}
      <Eyebrow tone="accent">{t('engagement.tip.sentEyebrow')}</Eyebrow>
      <h1 className="tip-success__title">{t('engagement.tip.successTitle')}</h1>
      <div className="tip-success__amount">
        <span className="money">{amount} {currency}</span>
        {recipient && <span className="tip-success__to">@{recipient}</span>}
      </div>
      <p className="tip-success__msg">
        {t('engagement.tip.successMessage', { amount, currency })}
      </p>
      {monthly && <p className="tip-success__msg">{t('engagement.tip.monthly.successNote')}</p>}
      <Button variant="inverse" size={48} block trailing="check" onClick={onClose} className="tip-success__btn">
        {t('common.actions.close')}
      </Button>
    </div>
  );
};

export default Success;
