/**
 * Where a vehicle sits in its source → variant lineage, as a glyph
 * (`lineageRole` in vehicleInheritance.js):
 *
 *   origin        a dot in a ring — where the lineage starts
 *   has-variants  a fork — a variant that others inherit from in turn
 *   end           an elbow — a variant nothing inherits from
 *
 * Drawn in currentColor, so it takes the color of the line it sits in.
 */
const PATHS = {
    origin: (
        <>
            <circle cx="12" cy="12" r="7" />
            <circle cx="12" cy="12" r="2" fill="currentColor" />
        </>
    ),
    'has-variants': (
        <>
            <circle cx="12" cy="18" r="2" />
            <circle cx="7" cy="6" r="2" />
            <circle cx="17" cy="6" r="2" />
            <path d="M7 8v2a2 2 0 0 0 2 2h6a2 2 0 0 0 2 -2v-2" />
            <path d="M12 12v4" />
        </>
    ),
    end: <path d="M6 6v6a3 3 0 0 0 3 3h10l-4 -4m0 8l4 -4" />,
};

export const LINEAGE_ROLE_LABEL = {
    origin: 'Origin: has variants',
    'has-variants': 'Variant, with variants of its own',
    end: 'Variant',
};

export default function LineageIcon({ role }) {
    if (!role) return null;
    return (
        <svg
            className="lineage-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            role="img"
            aria-label={LINEAGE_ROLE_LABEL[role]}
        >
            <title>{LINEAGE_ROLE_LABEL[role]}</title>
            {PATHS[role]}
        </svg>
    );
}
