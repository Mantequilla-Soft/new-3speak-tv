import { Check } from "lucide-react";
import "./StepProgress.scss";
import { useTranslation } from "react-i18next";


export const StepProgress = ({ step }) => {
  // Default values if none are provided
  const { t } = useTranslation();
  const defaultSteps = [t("upload.steps.selectVideo"), t("upload.steps.chooseThumbnail"), t("upload.steps.addDetails"), t("upload.steps.previewUpload")];
  const safeSteps =  defaultSteps;
  const safeTotalSteps = safeSteps.length;
  const safeCurrentStep = step;

  return (
    <div className="step-progress">
      <div className="step-progress__container">
        {safeSteps.map((step, index) => {
          const stepNumber = index + 1;
          const isCompleted = stepNumber < safeCurrentStep;
          const isActive = stepNumber === safeCurrentStep;

          return (
            <div key={stepNumber} className="step-progress__step">
              <div
                className={`step-progress__circle ${
                  isCompleted
                    ? "step-progress__circle--completed"
                    : isActive
                    ? "step-progress__circle--active"
                    : "step-progress__circle--inactive"
                }`}
              >
                {isCompleted ? (
                  <Check className="w-5 h-5" />
                ) : (
                  stepNumber
                )}
              </div>
              <span
                className={`step-progress__label ${
                  isCompleted || isActive
                    ? "step-progress__label--active"
                    : "step-progress__label--inactive"
                }`}
              >
                {step}
              </span>
              {stepNumber < safeTotalSteps && (
                <div
                  className={`step-progress__connector ${
                    isCompleted
                      ? "step-progress__connector--completed"
                      : "step-progress__connector--inactive"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
