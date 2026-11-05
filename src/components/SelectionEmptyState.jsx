/**
 * What a chart shows with nothing selected: that there is nothing to plot, and
 * where to get something — the vehicle quick-add's "＋ Add" in the chips row
 * directly above, or Vehicles & Specs.
 *
 * One for every chart, rather than one per view, because the answer is the
 * same everywhere. Charts used to be unreachable with an empty selection
 * instead (see chartNav's entryModeFor); now they are reachable, and this is
 * what keeps an empty one from being a blank page — including straight after
 * ⌧ Clear on a chart.
 *
 *   chart  the chart's label, for the heading ("Charging Curves")
 *   extra  a further sentence, for a chart with another way out of here
 */
export default function SelectionEmptyState({ chart, extra = null }) {
    return (
        <div className="empty-state">
            <h3 className="section-title">{chart}: nothing selected yet</h3>
            <p className="text-secondary mt-2">
                Use ＋ Add above to pick vehicles, or choose them on Vehicles &amp; Specs.{extra && ` ${extra}`}
            </p>
        </div>
    );
}
