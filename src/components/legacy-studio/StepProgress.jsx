import { Check } from "lucide-react";
import "./StepProgress.scss";
import { useTranslation } from "react-i18next";

// The upload wizard's stepper.
//
// One row that spans the page's content width: each step is a small numbered
// ring with its label beside it, joined by lines that fill the space between,
// so the first step sits on the content's left edge and the last on its right
// edge whatever the page width. Rings are OUTLINED in the accent colour (3Speak
// uses red as outline, never as a fill), the current one with a soft halo.
// Phones keep the rings and lines and show only the current step's name below.
//
// `short`: shorts have no Timeline step (chapters and link toasters are for
// long-form videos), so they keep the original four.
//
// `labels`: another flow's own steps (the batch import dialog), in order.
//
// EmbedUploadProgressBar measures `.step-progress__container` /
// `.step-progress__step` to match its width to the row; keep those classes.
export const StepProgress = ({ step, short = false, labels = null }) => {
  const { t } = useTranslation();
  const steps = labels || (short
    ? [t("upload.steps.selectVideo"), t("upload.steps.chooseThumbnail"), t("upload.steps.addDetails"), t("upload.steps.previewUpload")]
    : [t("upload.steps.selectVideo"), t("upload.steps.chooseThumbnail"), t("upload.steps.addDetails"), t("upload.steps.timeline"), t("upload.steps.previewUpload")]);
  const current = step;
  const stateOf = (n) => (n < current ? "done" : n === current ? "active" : "todo");

  return (
    <nav className="step-progress" aria-label={steps[current - 1] || undefined}>
      <ol className="step-progress__container">
        {steps.map((label, index) => {
          const n = index + 1;
          const state = stateOf(n);
          return (
            <li key={n} className="step-progress__item">
              <div
                className={`step-progress__step is-${state}`}
                aria-current={state === "active" ? "step" : undefined}
              >
                <span className="step-progress__circle">
                  {state === "done" ? <Check size={16} strokeWidth={3} aria-hidden="true" /> : n}
                </span>
                <span className="step-progress__label">{label}</span>
              </div>
              {n < steps.length && (
                <span className={`step-progress__line${n < current ? " is-done" : ""}`} aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>
      {/* Phones: the row has no room for labels, so the current one sits below. */}
      <div className="step-progress__caption">{steps[current - 1]}</div>
    </nav>
  );
};
