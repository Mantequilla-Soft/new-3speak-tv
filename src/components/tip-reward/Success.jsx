import React, { useEffect } from 'react';
import confetti from 'canvas-confetti';
// import { Button } from "@/components/ui/button";
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './Success.scss';



const Success = ({ amount, currency, onClose }) => {
  const { t } = useTranslation();
  useEffect(() => {
    const duration = 3000;
    const end = Date.now() + duration;

    const frame = () => {
      confetti({
        particleCount: 2,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: ['#ff3e3e', '#0066cc', '#ffffff']
      });
      
      confetti({
        particleCount: 2,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: ['#ff3e3e', '#0066cc', '#ffffff']
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    };

    frame();
  }, []);

  return (
      <div className="success-page-content">
        <div className="icon">
          <Check size={40} />
        </div>
        <h1 className="title">{t('engagement.tip.successTitle')}</h1>
        <p className="message">
          {t('engagement.tip.successMessage', { amount, currency })}
        </p>
        <button 
          onClick={onClose}
          className="button"
        >
          {t('common.actions.close')}
        </button>
      </div>
  );
};

export default Success;