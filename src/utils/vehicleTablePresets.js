/**
 * The vehicle table's presets (#335): a named set of columns in a set order,
 * with a sort, each answering one question a reader brings to the table.
 *
 * On screen the choice is labelled "Compare for" — Performance, Road trips,
 * Value — because the reader picks a purpose, not a configuration. "Preset" is
 * the name in code and in docs/vocabulary.md, and the control's tooltip says it.
 *
 * Hardcoded for now. The next step moves them to a curator-editable table, so
 * each entry is already the shape a row there will hold: key, label,
 * description, ordered column keys, sort key and direction. The plan, and the
 * reasoning behind every column below, is on #335.
 *
 * ── Which preset is showing ─────────────────────────────────────────────────
 *
 * Decided by the COLUMNS alone, never remembered separately: a table showing
 * exactly Road trips' columns is Road trips, however it got there. Sorting
 * does not change that — re-sorting a preset is using it, not leaving it.
 * Changing a column does, and the table is then "modified from" the preset it
 * started as.
 *
 * Data only, with no imports: vehicleTable.js reads it (Overview IS the
 * table's default), and matching, retired-key handling and the URL live there.
 */

export const VEHICLE_TABLE_PRESETS = [
    {
        key: 'overview',
        label: 'Overview',
        description: 'A little of everything: battery, range, pace, size and charging.',
        // The table's default: what it opens with before anything is picked.
        columns: [
            'name', 'figures.socWindowKwh', 'figures.epaRangeMi',
            'tested.zero_to_60_rollout_sec', 'tested.quarter_mile_sec',
            'powertrain.horsepower_hp', 'powertrain.drive_type', 'performance.weight_lbs',
            'dimensions.length_in', 'dimensions.width_in', 'dimensions.height_in', 'dimensions.wheelbase_in',
            'interior.seating', 'interior.cargo_cuft', 'interior.frunk_cuft',
            'charging.battery_nominal_voltage_v', 'charging.max_ac_kw',
        ],
        sortKey: 'name', sortDir: 'asc',
    },
    {
        key: 'performance',
        label: 'Performance',
        description: 'Power, weight and pace — claimed beside tested.',
        columns: [
            'name', 'powertrain.horsepower_hp', 'powertrain.torque_lbft', 'performance.weight_lbs',
            'calc.weightPerHp', 'performance.zero_to_60_mph_sec', 'tested.zero_to_60_rollout_sec',
            'tested.quarter_mile_sec', 'tested.quarter_mile_trap_mph',
            'powertrain.drive_type', 'powertrain.motors', 'powertrain.motor_type',
        ],
        sortKey: 'performance.zero_to_60_mph_sec', sortDir: 'asc',
    },
    {
        key: 'under-the-skin',
        label: 'Under the skin',
        description: 'Pack, voltage and charging hardware, for the engineering-minded.',
        columns: [
            'name', 'charging.battery_usable_kwh', 'powertrain.battery_gross_kwh', 'calc.batteryBuffer',
            'charging.battery_nominal_voltage_v', 'calc.is800v', 'charging.max_dc_kw',
            'calc.avgKw10to80', 'calc.peakCRate', 'powertrain.motor_type',
            'suspension.adaptive_damping', 'suspension.adjustable_height',
            'compute.processing_chip', 'compute.lidar',
        ],
        sortKey: 'calc.avgKw10to80', sortDir: 'desc',
    },
    {
        key: 'road-trips',
        label: 'Road trips',
        description: 'Range, and how much of it a charging stop puts back per minute.',
        columns: [
            'name', 'figures.epaRangeMi', 'figures.epaHwyMi', 'charging.max_dc_kw',
            'charging.charge_time_10_to_80_pct_min', 'calc.rangePerChargeMin', 'calc.timeToAdd', 'charging.charge_port',
            'interior.seating', 'calc.totalCargo', 'interior.max_cargo_cuft',
            'interior.front_heated_seats', 'interior.heated_steering_wheel', 'interior.hud',
        ],
        sortKey: 'calc.rangePerChargeMin', sortDir: 'desc',
    },
    {
        key: 'value',
        label: 'Value',
        description: 'What the base price buys: range, battery, space and features.',
        columns: [
            'name', 'pricing.base_price_usd', 'figures.epaRangeMi', 'calc.pricePerMile',
            'figures.socWindowKwh', 'calc.pricePerKwh', 'powertrain.horsepower_hp', 'interior.seating',
            'calc.totalCargo', 'charging.max_dc_kw', 'infotainment.carplay', 'infotainment.android_auto',
            'interior.front_heated_seats', 'charging.v2l',
        ],
        sortKey: 'calc.pricePerMile', sortDir: 'asc',
    },
    {
        key: 'efficiency',
        label: 'Efficiency',
        description: 'Miles per kWh, and the visible reasons two versions of a car differ.',
        columns: [
            'name', 'calc.efficiency', 'figures.epaCityMi', 'figures.epaHwyMi', 'figures.socWindowKwh',
            'performance.weight_lbs', 'powertrain.drive_type', 'wheels.wheel_size_in', 'wheels.tire_size',
            'dimensions.height_in', 'charging.max_ac_kw', 'charging.v2l',
        ],
        sortKey: 'calc.efficiency', sortDir: 'desc',
    },
    {
        key: 'size-and-cargo',
        label: 'Size & cargo',
        description: 'Footprint, clearance and room inside.',
        columns: [
            'name', 'dimensions.length_in', 'dimensions.width_in', 'dimensions.height_in',
            'dimensions.wheelbase_in', 'dimensions.ground_clearance_in', 'interior.seating',
            'interior.cargo_cuft', 'interior.frunk_cuft', 'interior.max_cargo_cuft',
        ],
        sortKey: 'dimensions.length_in', sortDir: 'desc',
    },
];
