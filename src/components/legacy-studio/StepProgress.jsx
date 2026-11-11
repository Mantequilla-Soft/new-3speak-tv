import "./StepProgress.scss";
import { useTranslation } from "react-i18next";
import { Icon } from "../v2/Icon";
import StepActions from "../embed-studio/StepActions";

// The upload wizard's stepper (design 21c: "a stepper of tiles").
//
// Each step is a 44px tile: an icon box and the step's name. Done steps get a
// cyan box with a check, the current one an accent tint with an accent border,
// the ones still to come a muted outline. Below the full-width layout only the
// current tile keeps its name; the others shrink to their icon box (the name
// stays for screen readers and as a tooltip).
//
// `short`: shorts have no Timeline step (chapters and link toasters are for
// long-form videos), so they keep the original four.
//
// `labels`: another flow's own steps (the batch import dialog), in order. They
// have no icons of their own, so their boxes show the step number.
//
// `actions`: the step's action row (StepActions props). Given, the top row sits
// in the same bar as the tiles, Back and Next on the right as in 21c; the page
// renders the bottom row itself, from the same object.
const UPLOAD_ICONS = ["upload", "image", "edit_note", "timeline", "send"];
const SHORT_ICONS = ["upload", "image", "edit_note", "send"];

export const StepProgress = ({ step, short = false, labels = null, actions = null }) => {
  const { t } = useTranslation();
  const steps = labels || (short
    ? [t("upload.steps.selectVideo"), t("upload.steps.chooseThumbnail"), t("upload.steps.addDetails"), t("upload.steps.previewUpload")]
    : [t("upload.steps.selectVideo"), t("upload.steps.chooseThumbnail"), t("upload.steps.addDetails"), t("upload.steps.timeline"), t("upload.steps.previewUpload")]);
  const icons = labels ? null : short ? SHORT_ICONS : UPLOAD_ICONS;
  const current = step;
  const stateOf = (n) => (n < current ? "done" : n === current ? "active" : "todo");

  return (
    <nav className={`step-progress${actions ? " step-progress--bar" : ""}`} aria-label={steps[current - 1] || undefined}>
      <ol className="step-progress__container">
        {steps.map((label, index) => {
          const n = index + 1;
          const state = stateOf(n);
          return (
            <li key={n} className="step-progress__item">
              <div
                className={`step-progress__step is-${state}`}
                aria-current={state === "active" ? "step" : undefined}
                title={label}
              >
                <span className="step-progress__circle">
                  {state === "done"
                    ? <Icon name="check" size={18} />
                    : icons ? <Icon name={icons[index]} size={18} /> : <span className="num">{n}</span>}
                </span>
                <span className="step-progress__label">{label}</span>
              </div>
            </li>
          );
        })}
      </ol>
      {actions && (
        <div className="step-progress__actions">
          <StepActions placement="top" {...actions} />
        </div>
      )}
    </nav>
  );
};
