import SidebarDisplaySection from '../SidebarDisplaySection';
import AnchorIcon from './AnchorIcon';
import { SIZE_ANCHORS, SIZE_VIEWS, SIZE_DRAWS } from '../../constants/sizeChart';

/**
 * The Size chart's sidebar: which view, what the vehicles are lined up on, and
 * Display (photos or outlines, lines, grid). The vehicles are the selection, picked from the chips like every
 * chart's.
 */
export default function SizeChartSidebar({ view, anchor, draw, lines, grid, onChange }) {
    return (
        <aside className="chart-rail">
            <div className="chart-rail-group">
                <span className="text-micro">View</span>
                <div className="segmented" role="group" aria-label="View">
                    {SIZE_VIEWS.map(v => (
                        <button
                            key={v.key}
                            type="button"
                            className={view === v.key ? 'active' : ''}
                            aria-pressed={view === v.key}
                            onClick={() => onChange({ sizeView: v.key })}
                        >
                            {v.label}
                        </button>
                    ))}
                </div>
            </div>

            {view === 'side' && (
                <div className="chart-rail-group">
                    <span className="text-micro">Line up on</span>
                    <div className="segmented size-anchors" role="group" aria-label="Line up on">
                        {SIZE_ANCHORS.map(a => (
                            <button
                                key={a.key}
                                type="button"
                                className={anchor === a.key ? 'active' : ''}
                                aria-pressed={anchor === a.key}
                                onClick={() => onChange({ sizeAnchor: a.key })}
                            >
                                <AnchorIcon anchor={a.key} />
                                <span>{a.label}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <SidebarDisplaySection title="Display">
                <div className="segmented" role="group" aria-label="Draw">
                    {SIZE_DRAWS.map(d => (
                        <button
                            key={d.key}
                            type="button"
                            className={draw === d.key ? 'active' : ''}
                            aria-pressed={draw === d.key}
                            onClick={() => onChange({ sizeDraw: d.key })}
                        >
                            {d.label}
                        </button>
                    ))}
                </div>
                <div className="chart-toggles">
                    <label className="toggle-label">
                        <input type="checkbox" checked={lines} onChange={e => onChange({ sizeLines: e.target.checked })} />
                        <span className="text-control">Dimension lines</span>
                    </label>
                    <label className="toggle-label">
                        <input type="checkbox" checked={grid} onChange={e => onChange({ sizeGrid: e.target.checked })} />
                        <span className="text-control">Grid</span>
                    </label>
                </div>
            </SidebarDisplaySection>
        </aside>
    );
}
