/**
 * EPA configurations to link, suggested from a variant's source (#341) — or,
 * with no source to go on, from the vehicle's own make, model and year.
 *
 * Shown to a curator on a variant, and kept after a link — a variant spanning
 * wheel sizes links several, and the next is found here. Starts folded when the
 * tab opens on a vehicle already linked (`startCollapsed`, read once). A variant's figures never
 * borrow its source's certification — a different car is almost always a
 * different label, and a wrong figure is worse than none — so this is where the
 * source helps instead: it says where the variant's own configuration probably
 * is, and one click links it.
 *
 * Each row carries its label range and EPA tested capacity, the figures the
 * link will give the vehicle, so a wrong fit shows before it is linked rather
 * than after. Ranking and the reasoning behind it: variantEpaSuggestions.js.
 */
import { useEffect, useMemo, useState } from 'react';
import { vehicleLabel } from '../../utils/specHelpers';
import { candidateQuery, rankSuggestions, SUGGESTION_LIMIT } from '../../utils/variantEpaSuggestions';

const miles = (v) => (v != null ? `${Math.round(v)} mi` : '—');
const kwh   = (v) => (v != null ? `${Math.round(v * 10) / 10} kWh` : '—');
const yearSpan = (ys) => (ys.length > 1 ? `${ys[0]}–${ys[ys.length - 1]}` : String(ys[0] ?? ''));

export default function VariantEpaSuggestions({ vehicle, source, startCollapsed = false, getCandidates, onLink }) {
    const [open, setOpen] = useState(!startCollapsed);
    const query = useMemo(() => candidateQuery(vehicle, source), [vehicle, source]);
    const queryKey = JSON.stringify(query);
    // Keyed by the query that produced them, so a different vehicle never
    // briefly ranks the last one's candidates, and nothing resets in the effect.
    const [fetched, setFetched] = useState({ key: null, rows: [], error: null });
    const [showAll, setShowAll] = useState(false);
    const [linking, setLinking] = useState(null);

    useEffect(() => {
        let live = true;
        Promise.resolve(getCandidates?.(JSON.parse(queryKey)))
            .then(rows => { if (live) setFetched({ key: queryKey, rows: rows ?? [], error: null }); })
            .catch(e => { if (live) setFetched({ key: queryKey, rows: [], error: e?.message || 'Could not load suggestions' }); });
        return () => { live = false; };
    }, [queryKey, getCandidates]);

    const loading = fetched.key !== queryKey;
    const suggestions = useMemo(
        () => rankSuggestions(vehicle, source, loading ? [] : fetched.rows),
        [vehicle, source, fetched, loading],
    );
    const siblings = suggestions.filter(s => !s.fromSource);
    const own = suggestions.filter(s => s.fromSource);
    const shownSiblings = showAll ? siblings : siblings.slice(0, SUGGESTION_LIMIT);

    const link = async (group) => {
        setLinking(group.test_group_id);
        try {
            await onLink(vehicle.id, group.test_group_id, 'inferred', null);
        } finally {
            setLinking(null);
        }
    };

    const row = (s) => (
        <div key={s.group.test_group_id} className={`primary-config-option config-suggestion option-row ${s.linked ? 'is-selected' : ''}`}>
            <span className="min-w-0">
                <span className="block truncate">
                    {s.figures.name}
                    {s.matched.length > 0 && (
                        <span className="text-caption"> · matches “{s.matched.join(' ')}”</span>
                    )}
                </span>
                <span className="block font-mono text-caption truncate">
                    {s.figures.id}{s.group.drive ? ` · ${s.group.drive}` : ''}
                </span>
            </span>
            <span className="primary-config-figure">{miles(s.figures.labelRangeMi)}</span>
            <span className="primary-config-figure">{kwh(s.figures.testedKwh)}</span>
            {s.linked ? (
                <span className="text-caption text-right">Linked</span>
            ) : (
                <button
                    type="button"
                    className="btn btn-primary disabled:opacity-60"
                    disabled={linking != null}
                    onClick={() => link(s.group)}
                >
                    {linking === s.group.test_group_id ? 'Linking…' : 'Link'}
                </button>
            )}
        </div>
    );

    return (
        <div className="primary-config-picker" aria-label="Suggested EPA configurations">
            <div className="primary-config-option config-suggestion is-header text-micro">
                <button
                    type="button"
                    className="config-suggestions-toggle"
                    aria-expanded={open}
                    onClick={() => setOpen(v => !v)}
                >
                    <span className="disclosure-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
                    {source ? `Suggested from ${vehicleLabel(source)}` : `Suggested for ${vehicleLabel(vehicle)}`}
                    {!open && !loading && ` (${siblings.length + own.length})`}
                </button>
                {open ? (
                    <>
                        <span className="primary-config-figure">Label range</span>
                        <span className="primary-config-figure">EPA tested</span>
                    </>
                ) : <><span /><span /></>}
                <span />
            </div>

            {open && (
            <>

            {loading && <p className="primary-config-note text-caption">Looking for configurations…</p>}
            {fetched.error && <p className="primary-config-note text-caption">{fetched.error}</p>}

            {!loading && shownSiblings.map(row)}
            {!loading && siblings.length > SUGGESTION_LIMIT && (
                <button type="button" className="fe-picker-link-btn mx-3 my-1" onClick={() => setShowAll(v => !v)}>
                    {showAll ? 'Show fewer' : `Show all ${siblings.length}`}
                </button>
            )}
            {!loading && !siblings.length && !fetched.error && (
                <p className="primary-config-note text-caption">
                    {source
                        ? `No other ${source.model || 'configuration'} certified in the same model year.`
                        : `No ${[vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'configuration'} certified for ${yearSpan(query.years) || 'this model year'} in the EPA data yet.`}
                </p>
            )}

            {own.length > 0 && (
                <>
                    <div className="primary-config-option config-suggestion is-header text-micro">
                        <span>Linked to {vehicleLabel(source)}</span>
                        <span /><span /><span />
                    </div>
                    {own.map(row)}
                </>
            )}

            <p className="primary-config-note text-caption">
                A variant's EPA figures come only from configurations linked to it. Link the one
                certified for this car; if none is, leave it empty rather than borrowing one.
            </p>
            </>
            )}
        </div>
    );
}
