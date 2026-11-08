/**
 * The setup wizard (PROTOTYPE): a few skippable questions for a new reader,
 * then one Apply that sets the site up from the answers.
 *
 * The answers live here only while it is open; nothing is remembered. Apply
 * hands App a plan (utils/setupWizard.js planFromAnswers) and App writes it
 * through its own setters (applySetup).
 */
import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { buildVehicleLabels } from '../../utils/seriesLabel';
import { EMPTY_ANSWERS, planFromAnswers, planSummary } from '../../utils/setupWizard';
import { GoalStep, CarsStep, DrivingStep, WeatherStep, MoneyStep, SummaryStep } from './SetupSteps';

/** The steps in order; `keys` are the answers a step's Skip clears. */
const STEPS = [
    { key: 'goal',    title: 'What do you want to know?', Body: GoalStep,    keys: ['goal'] },
    { key: 'cars',    title: 'Which cars?',               Body: CarsStep,    keys: ['cars'] },
    { key: 'driving', title: 'How do you drive?',         Body: DrivingStep, keys: ['dailyMi', 'highway', 'speedMph', 'trips', 'tripMi'] },
    { key: 'weather', title: "What's the weather like?",  Body: WeatherStep, keys: ['climate', 'mountains'] },
    { key: 'money',   title: 'Charging and costs',        Body: MoneyStep,   keys: ['home', 'homePrice', 'gasMpg', 'gasPrice'] },
    { key: 'summary', title: "Here's what we'll set",     Body: null,        keys: [] },
];

export default function SetupWizard({ onApply, onClose }) {
    const { vehicles, selectedVehicles } = useAppContext();
    const [step, setStep] = useState(0);
    const [answers, setAnswers] = useState(EMPTY_ANSWERS);
    const patch = (p) => setAnswers(prev => ({ ...prev, ...p }));

    useEffect(() => {
        const onKey = e => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const names = useMemo(() => {
        const labels = buildVehicleLabels(vehicles);
        return Object.fromEntries([...labels].map(([id, l]) => [id, l.short]));
    }, [vehicles]);

    const current = STEPS[step];
    const isSummary = current.key === 'summary';
    const plan = useMemo(
        () => (isSummary ? planFromAnswers(answers, { vehicles, selectedIds: selectedVehicles }) : null),
        [isSummary, answers, vehicles, selectedVehicles]);
    const answered = current.keys.some(k => answers[k] != null);

    const skip = () => {
        patch(Object.fromEntries(current.keys.map(k => [k, null])));
        setStep(s => s + 1);
    };

    const { Body } = current;
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                className="modal-panel setup-panel"
                role="dialog"
                aria-labelledby="setup-title"
                onClick={e => e.stopPropagation()}
            >
                <div className="modal-header setup-header">
                    <div>
                        <span className="text-micro">Set up · {step + 1} of {STEPS.length}</span>
                        <h3 id="setup-title" className="section-title">{current.title}</h3>
                    </div>
                    <button type="button" className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
                </div>
                <div className="modal-body">
                    {isSummary
                        ? <SummaryStep lines={planSummary(plan, answers, names)} unset={plan.unset} />
                        : <Body answers={answers} onChange={patch} vehicles={vehicles} selectedIds={selectedVehicles} names={names} />}
                </div>
                <div className="modal-footer setup-footer">
                    {step > 0 && <button type="button" className="btn btn-secondary" onClick={() => setStep(s => s - 1)}>Back</button>}
                    <span className="setup-footer-gap" />
                    {isSummary ? (
                        <button type="button" className="btn btn-commit" onClick={() => onApply(plan)} autoFocus>Apply</button>
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
