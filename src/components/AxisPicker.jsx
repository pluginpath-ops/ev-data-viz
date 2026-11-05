import { Fragment } from 'react';
import { groupAxes } from '../utils/chargingAxes';

/**
 * Which axes Charging Curves plots: the spec chart's field picker, for a chart
 * that has three. A grouped list, each row carrying an X, a Y and a Y2 toggle.
 * Three dropdowns of twelve ungrouped names asked the reader to know where
 * "Range Rate" sat among them; the groups (Time, Charging speed, Range, Range
 * added) say what each choice measures before its unit does.
 *
 * Twelve rows do not need a filter and the list shows whole, so the lit toggles
 * are always in view. What is plotted is stated in the section header above.
 *
 * Y2 is optional, so pressing the Y2 on the axis already there clears it.
 *
 * @param {Array}  options  chargingAxisOptions(units)
 * @param {{x, y, y2}} axes  the three axis keys; y2 may be null
 * @param {Function} onChange  ({ x, y, y2 }) with the one that changed
 */
export default function AxisPicker({ options, axes, onChange }) {
    const choose = (key, axis) => {
        const next = { x: axes.x, y: axes.y, y2: axes.y2 ?? null, [axis]: key };
        if (axis === 'y2' && axes.y2 === key) next.y2 = null;
        onChange(next);
    };

    return (
        <div className="guide-facet-panel">
            <div className="field-picker-list is-whole">
                {groupAxes(options).map(({ group, options: inGroup }) => (
                    <Fragment key={group}>
                        <div className="guide-column-group text-nano">{group}</div>
                        {inGroup.map(opt => {
                            const on = (axis) => axes[axis] === opt.value;
                            return (
                                <div
                                    key={opt.value}
                                    className={`guide-column-row field-picker-row${on('x') || on('y') || on('y2') ? ' is-selected' : ''}`}
                                >
                                    <span className="guide-column-name" title={opt.label}>{opt.name}</span>
                                    {opt.unit && <span className="guide-column-unit">{opt.unit}</span>}
                                    {['x', 'y', 'y2'].map(axis => (
                                        <button
                                            key={axis}
                                            type="button"
                                            className={`field-picker-axis${on(axis) ? ' active' : ''}`}
                                            aria-pressed={on(axis)}
                                            aria-label={`${opt.label} on the ${axis.toUpperCase()} axis`}
                                            onClick={() => choose(opt.value, axis)}
                                        >
                                            {axis.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                            );
                        })}
                    </Fragment>
                ))}
            </div>
        </div>
    );
}
