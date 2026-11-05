import { useReadoutFixed } from '../../hooks/useChartReadout';

/**
 * The PNG button, and beside it "Side readout": [PNG | Side readout], one control with
 * a dashed divider (#456).
 *
 * PNG copies the framed chart, with a fixed readout drawn over the plot.
 * "Side readout" copies it with the readout's values in a panel BESIDE the plot, so
 * a crowded chart is exported with nothing covered. It is always present and
 * greyed out until a readout is fixed — a button that appeared on fixing would
 * shift the ones beside it.
 *
 * @param {object} readout            from useChartReadout
 * @param {() => void} onCopy, onCopyBeside  useChartPng's copyPng and copyPngBeside
 * @param {boolean} copied, copiedBeside      useChartPng's flags, for the ✓
 * @param {boolean} [disabled]        the view's own reason the chart cannot be copied
 */
export default function CopyPngButton({ readout, onCopy, onCopyBeside, copied, copiedBeside, disabled = false }) {
    const fixed = useReadoutFixed(readout);
    const active = (on) => `chart-copy-btn ${on ? 'chart-copy-btn-active' : ''}`;
    return (
        <span className="chart-copy-split">
            <button type="button" onClick={onCopy} disabled={disabled} className={active(copied)}
                    title="Copy the framed chart as a PNG">
                {copied ? '✓ Copied' : 'PNG'}
            </button>
            <button type="button" onClick={onCopyBeside} disabled={disabled || !fixed}
                    className={active(copiedBeside)}
                    title={fixed
                        ? 'Copy the framed chart as a PNG, with the fixed readout\'s values in a panel beside the plot'
                        : 'Click the chart to fix a readout first; its values then go in a panel beside the plot'}>
                {copiedBeside ? '✓ Copied' : 'Side readout'}
            </button>
        </span>
    );
}
