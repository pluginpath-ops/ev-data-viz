/**
 * The setup wizard: a few skippable questions for a new reader, then one
 * Apply that sets the site up from the answers.
 *
 * The screens and their words are constants/setupWizard.js. The answers are
 * remembered in this browser (setupWizardStorage.js), so reopening starts from
 * the last ones. Apply hands App a plan (utils/setupWizard.js planFromAnswers)
 * and App writes it through its own setters (applySetup).
 *
 *   onApply(plan, answers)   Apply pressed
 *   onClose(stepKey)         closed without applying, on that step
 */
import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { buildVehicleLabels } from '../../utils/seriesLabel';
import { STEP_ANSWERS, planFromAnswers, planSummary } from '../../utils/setupWizard';
import { readSetupAnswers, writeSetupAnswers } from '../../utils/setupWizardStorage';
import { SETUP_WIZARD } from '../../constants/setupWizard';
import { GoalStep, CarsStep, DrivingStep, WeatherStep, MoneyStep, SummaryStep } from './SetupSteps';

/** Each step key's screen; the order and titles are the config's. */
const BODIES = { goal: GoalStep, cars: CarsStep, driving: DrivingStep, weather: WeatherStep, money: MoneyStep, summary: null };

export default function SetupWizard({ onApply, onClose }) {
    const { vehicles, selectedVehicles, units } = useAppContext();
    const steps = SETUP_WIZARD.steps;
    const [step, setStep] = useState(0);
    const [answers, setAnswers] = useState(readSetupAnswers);
    const patch = (p) => setAnswers(prev => ({ ...prev, ...p }));

    const current = steps[step];
    const close = () => { writeSetupAnswers(answers); onClose(current.key); };

    useEffect(() => {
        const onKey = e => { if (e.key === 'Escape') { writeSetupAnswers(answers); onClose(current.key); } };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [answers, current.key, onClose]);

    const names = useMemo(() => {
        const labels = buildVehicleLabels(vehicles);
        return Object.fromEntries([...labels].map(([id, l]) => [id, l.short]));
    }, [vehicles]);

    const isSummary = current.key === 'summary';
    const plan = useMemo(
        () => (isSummary ? planFromAnswers(answers, { vehicles, selectedIds: selectedVehicles }) : null),
        [isSummary, answers, vehicles, selectedVehicles]);
    const keys = STEP_ANSWERS[current.key];
    const answered = keys.some(k => answers[k] != null);

    const skip = () => {
        patch(Object.fromEntries(keys.map(k => [k, null])));
        setStep(s => s + 1);
    };
    const apply = () => {
        writeSetupAnswers(answers);
        onApply(plan, answers);
    };

    const Body = BODIES[current.key];
    return (
        <div className="modal-overlay" onClick={close}>
            <div
                className="modal-panel setup-panel"
                role="dialog"
                aria-labelledby="setup-title"
                onClick={e => e.stopPropagation()}
            >
                <div className="modal-header setup-header">
                    <div>
                        <span className="text-micro">Set up · {step + 1} of {steps.length}</span>
                        <h3 id="setup-title" className="section-title">{current.title}</h3>
                    </div>
                    <button type="button" className="modal-close" onClick={close} aria-label="Close">&times;</button>
                </div>
                <div className="modal-body">
                    {isSummary
                        ? <SummaryStep lines={planSummary(plan, answers, names, units)} unset={plan.unset} />
                        : <Body answers={answers} onChange={patch} vehicles={vehicles} selectedIds={selectedVehicles} names={names} units={units} />}
                </div>
                <div className="modal-footer setup-footer">
                    {step > 0 && <button type="button" className="btn btn-secondary" onClick={() => setStep(s => s - 1)}>Back</button>}
                    <span className="setup-footer-gap" />
                    {isSummary ? (
                        <button type="button" className="btn btn-commit" onClick={apply} autoFocus>Apply</button>
                    ) : (
                        <>
                            <button type="button" className="btn btn-secondary" onClick={skip}>Skip</button>
                            <button type="button" className="btn btn-commit" onClick={() => setStep(s => s + 1)} disabled={!answered}>Next</button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
