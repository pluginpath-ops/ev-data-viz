import { useState, useMemo, useCallback } from 'react';
import { useAppContext } from '../../context/AppContext';
import { useAsyncResource } from '../../hooks/useAsyncResource';

/**
 * The brand registry (#149, #243).
 *
 * `manufacturers` is the one list of brands in the app, and this is the only
 * place it can be maintained — before this, fixing the typo `Volkswage` meant
 * editing SQL.
 *
 * It serves two consumers that used to have nothing to do with each other:
 *
 *   • Vehicles, which reference a manufacturer by FK.
 *   • The Fuel Economy Guide, whose `division` column is EPA's raw filing text
 *     and lists the same company more than once — `Lucid` and `Lucid USA Inc.`
 *     split the public Make facet in two.
 *
 * Aliases are what join them. EPA's text is never rewritten: migration 053 keeps
 * the guide faithful to the source, so an alias maps for display and the filing
 * stays exactly as filed.
 */

/** Merge is destructive and asymmetric, so the direction is spelled out. */
function MergeControl({ brand, brands, onMerge, busy }) {
    const [target, setTarget] = useState('');
    const [confirming, setConfirming] = useState(false);

    const others = brands.filter(b => b.id !== brand.id);
    const targetBrand = others.find(b => String(b.id) === String(target));

    if (!confirming) {
        return (
            <div className="brand-merge">
                <select
                    className="form-input brand-select"
                    value={target}
                    onChange={e => setTarget(e.target.value)}
                    aria-label={`Merge ${brand.name} into`}
                >
                    <option value="">Merge into…</option>
                    {others.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <button
                    className="btn btn-secondary"
                    disabled={!target || busy}
                    onClick={() => setConfirming(true)}
                >
                    Merge
                </button>
            </div>
        );
    }

    return (
        <div className="brand-merge-confirm">
            <div className="text-note">
                Move everything from <strong>{brand.name}</strong> to <strong>{targetBrand?.name}</strong>?
                {' '}<strong>{brand.name}</strong> is deleted and becomes an alias of{' '}
                <strong>{targetBrand?.name}</strong>, so a re-import of the old spelling resolves
                instead of recreating it.
            </div>
            <div className="flex gap-2 mt-1">
                <button className="btn btn-warning" disabled={busy}
                    onClick={async () => { await onMerge(brand.id, Number(target)); setConfirming(false); setTarget(''); }}>
                    Yes, merge
                </button>
                <button className="btn btn-secondary" onClick={() => setConfirming(false)}>Cancel</button>
            </div>
        </div>
    );
}

/** One brand: name, parent, counts, aliases, merge and delete. */
function BrandRow({ brand, brands, usage, aliases, parents, onSave, onMerge, onDelete, onAddAlias, onDeleteAlias, busy }) {
    const [name, setName]     = useState(brand.name);
    const [parent, setParent] = useState(brand.parent_name ?? '');
    const [newAlias, setNewAlias] = useState('');
    const [showAliases, setShowAliases] = useState(false);

    // `usage` is null when the counts could not be read at all — see
    // DataService.getBrandUsageSummary. Unknown is not zero.
    const known = usage != null;
    const use = usage?.[brand.id] ?? { vehicles: 0, aliases: 0, guideRows: 0 };
    const dirty = name !== brand.name || parent !== (brand.parent_name ?? '');
    // A brand with vehicles or guide rows behind it must be merged, not
    // deleted: deleting nulls the FK and strands `vehicles.make`, leaving the
    // wrong spelling on every card with no brand to fix it from.
    //
    // Unknown counts block deletion too. Enabling it on a maybe would put the
    // destructive option one click away precisely when we cannot say whether
    // it is safe.
    const inUse = !known || use.vehicles > 0 || use.guideRows > 0;

    return (
        <div className="brand-row">
            <div className="brand-row-main">
                <input className="form-input brand-input" value={name} onChange={e => setName(e.target.value)} aria-label="Brand name" />
                <input
                    className="form-input brand-input"
                    value={parent}
                    onChange={e => setParent(e.target.value)}
                    placeholder="Corporate parent"
                    list="brand-parent-options"
                    aria-label="Corporate parent"
                />
                <div className="brand-counts text-meta">
                    {known ? (
                        <>
                            {use.vehicles} vehicle{use.vehicles === 1 ? '' : 's'}
                            {' · '}{use.guideRows} guide row{use.guideRows === 1 ? '' : 's'}
                            {' · '}
                            <button type="button" className="section-action" onClick={() => setShowAliases(s => !s)}>
                                {use.aliases} alias{use.aliases === 1 ? '' : 'es'}
                            </button>
                        </>
                    ) : (
                        <span title="Counts unavailable — migration 057 is not applied">usage unknown</span>
                    )}
                </div>
                <div className="brand-row-actions">
                    {dirty && (
                        <button className="btn btn-primary" disabled={busy || !name.trim()}
                            onClick={() => onSave(brand.id, { name: name.trim(), parent_name: parent.trim() || null })}>
                            Save
                        </button>
                    )}
                    <MergeControl brand={brand} brands={brands} onMerge={onMerge} busy={busy} />
                    <button
                        className="btn btn-danger"
                        disabled={busy || inUse}
                        title={!known
                            ? 'Usage counts are unavailable, so deleting is blocked — apply migration 057'
                            : inUse
                                ? 'Merge this brand instead — deleting would strand its vehicles and guide rows'
                                : 'Delete this brand'}
                        onClick={() => onDelete(brand.id)}
                    >
                        Delete
                    </button>
                </div>
            </div>

            {showAliases && (
                <div className="brand-aliases">
                    {aliases.length === 0 && <div className="text-note">No aliases.</div>}
                    {aliases.map(a => (
                        <span key={a.id} className="brand-alias-chip">
                            {a.alias}
                            <span className="text-meta"> · {a.source.replace('_', ' ')}</span>
                            <button type="button" onClick={() => onDeleteAlias(a.id)} aria-label={`Remove alias ${a.alias}`}>×</button>
                        </span>
                    ))}
                    <div className="brand-alias-add">
                        <input
                            className="form-input brand-input"
                            value={newAlias}
                            onChange={e => setNewAlias(e.target.value)}
                            placeholder="Add a spelling"
                            aria-label={`Add an alias for ${brand.name}`}
                        />
                        <button className="btn btn-secondary" disabled={!newAlias.trim() || busy}
                            onClick={async () => { await onAddAlias(brand.id, newAlias.trim()); setNewAlias(''); }}>
                            Add
                        </button>
                    </div>
                </div>
            )}
            <datalist id="brand-parent-options">
                {parents.map(p => <option key={p} value={p} />)}
            </datalist>
        </div>
    );
}

export default function BrandRegistry() {
    const {
        manufacturers, addManufacturer, updateManufacturer, deleteManufacturer,
        getBrandAliases, getBrandDivisionSummary, getBrandUsageSummary,
        addBrandAlias, deleteBrandAlias, mergeManufacturers,
    } = useAppContext();

    const loadAliases   = useCallback(() => getBrandAliases(), [getBrandAliases]);
    const loadDivisions = useCallback(() => getBrandDivisionSummary(), [getBrandDivisionSummary]);
    const loadUsage     = useCallback(() => getBrandUsageSummary(), [getBrandUsageSummary]);

    const { data: aliases,   reload: reloadAliases }   = useAsyncResource(loadAliases, []);
    const { data: divisions, reload: reloadDivisions } = useAsyncResource(loadDivisions, []);
    const { data: usage,     reload: reloadUsage }     = useAsyncResource(loadUsage, []);

    const [busy, setBusy] = useState(false);
    const [newBrandFor, setNewBrandFor] = useState(null);

    const refresh = async () => { reloadAliases(); reloadDivisions(); reloadUsage(); };

    const aliasesByBrand = useMemo(() => {
        const by = {};
        for (const a of aliases ?? []) (by[a.manufacturer_id] ??= []).push(a);
        return by;
    }, [aliases]);

    const parents = useMemo(
        () => [...new Set((manufacturers ?? []).map(m => m.parent_name).filter(Boolean))].sort(),
        [manufacturers],
    );

    const unmapped = useMemo(
        () => (divisions ?? []).filter(d => !d.manufacturerId),
        [divisions],
    );

    // The registry is the migration's own table; without it there is nothing to
    // maintain, and saying so beats an empty list that looks like no data.
    const migrationMissing = usage === null;

    const run = async (fn) => {
        setBusy(true);
        try { await fn(); await refresh(); }
        catch { /* AppContext surfaces the message */ }
        finally { setBusy(false); }
    };

    return (
        <div className="flex flex-col gap-5">
            {migrationMissing && (
                <div className="guide-warning">
                    No aliases are present. If brands look un-merged, migration
                    <code> 057_brand_registry.sql </code> has not been applied yet — the registry
                    reads and writes normally once it is.
                </div>
            )}

            <section>
                <div className="section-header">
                    <div className="section-header-title">Brands</div>
                    <div className="section-header-actions text-note">
                        {(manufacturers ?? []).length} brands
                    </div>
                </div>
                <div className="brand-list">
                    {(manufacturers ?? []).map(b => (
                        <BrandRow
                            key={b.id}
                            brand={b}
                            brands={manufacturers}
                            usage={usage}
                            aliases={aliasesByBrand[b.id] ?? []}
                            parents={parents}
                            busy={busy}
                            onSave={(id, updates) => run(() => updateManufacturer(id, updates))}
                            onMerge={(from, into) => run(() => mergeManufacturers(from, into))}
                            onDelete={(id) => run(() => deleteManufacturer(id))}
                            onAddAlias={(id, alias) => run(() => addBrandAlias(id, alias))}
                            onDeleteAlias={(id) => run(() => deleteBrandAlias(id))}
                        />
                    ))}
                </div>
            </section>

            <section>
                <div className="section-header">
                    <div className="section-header-title">EPA divisions awaiting a decision</div>
                    <div className="section-header-actions text-note">
                        {unmapped.length} unmapped
                    </div>
                </div>
                {/* Unmapped divisions are shown, not silently passed through: a
                    manufacturer appearing in a new import is exactly the case
                    this panel exists to catch. */}
                {unmapped.length === 0 ? (
                    <div className="text-note">
                        Every division EPA has filed resolves to a brand.
                    </div>
                ) : (
                    <div className="brand-list">
                        {unmapped.map(d => (
                            <div key={d.division} className="brand-row brand-row-main">
                                <div>
                                    <div>{d.division}</div>
                                    <div className="text-meta">
                                        {d.rowCount} configuration{d.rowCount === 1 ? '' : 's'}
                                    </div>
                                </div>
                                <select
                                    className="form-input brand-select"
                                    defaultValue=""
                                    disabled={busy}
                                    aria-label={`Map ${d.division} to a brand`}
                                    onChange={e => {
                                        const id = Number(e.target.value);
                                        if (id) run(() => addBrandAlias(id, d.division, 'epa_division'));
                                    }}
                                >
                                    <option value="">Map to an existing brand…</option>
                                    {(manufacturers ?? []).map(b => (
                                        <option key={b.id} value={b.id}>{b.name}</option>
                                    ))}
                                </select>
                                {newBrandFor === d.division ? (
                                    <NewBrandFromDivision
                                        division={d.division}
                                        busy={busy}
                                        onCancel={() => setNewBrandFor(null)}
                                        onCreate={(name) => run(async () => {
                                            const created = await addManufacturer(name);
                                            if (created?.id) await addBrandAlias(created.id, d.division, 'epa_division');
                                            setNewBrandFor(null);
                                        })}
                                    />
                                ) : (
                                    <button className="btn btn-secondary" disabled={busy}
                                        onClick={() => setNewBrandFor(d.division)}>
                                        New brand
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}

/**
 * Create a brand from an unmapped division.
 *
 * The name is editable rather than taken verbatim: EPA files
 * `Hai Phong manufacturing plant`, which is VinFast's factory, not a brand.
 */
function NewBrandFromDivision({ division, onCreate, onCancel, busy }) {
    const [name, setName] = useState(division);
    return (
        <div className="brand-merge">
            <input className="form-input brand-input" value={name} onChange={e => setName(e.target.value)}
                aria-label="New brand name" />
            <button className="btn btn-primary" disabled={busy || !name.trim()}
                onClick={() => onCreate(name.trim())}>Create</button>
            <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        </div>
    );
}
