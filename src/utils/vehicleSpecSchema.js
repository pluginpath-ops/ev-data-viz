/**
 * Vehicle specification schema — single source of truth for all spec categories,
 * field keys, display labels, input types, and enum options.
 *
 * Both VehicleSpecsDisplay (read-only) and EditSpecsForm (edit modal) derive their
 * structure entirely from this file. Adding a new category or field requires only
 * editing this array — no component changes needed.
 *
 * Field types:
 *   'number'  — numeric input (decimal allowed)
 *   'integer' — numeric input (step=1, integers only)
 *   'boolean' — Yes / No / blank select
 *   'enum'    — select from a fixed list of options
 *   'text'    — free-text input
 */

export const SPEC_CATEGORIES = [
    {
        key: 'pricing',
        label: 'Pricing',
        fields: [
            { key: 'base_price_usd', label: 'Advertised Base Price (USD)', type: 'number' },
        ],
    },
    {
        key: 'powertrain',
        label: 'Powertrain',
        fields: [
            { key: 'drive_type',          label: 'Drive Type',              type: 'enum',
              options: ['FWD', 'RWD', 'AWD'] },
            { key: 'motors',              label: 'Number of Motors',        type: 'integer' },
            { key: 'motor_type',          label: 'Motor Type',              type: 'enum',
              options: ['Permanent Magnet', 'Induction', 'Wound Rotor', 'Switched Reluctance'] },
            { key: 'transmission_speeds', label: 'Transmission Speeds',     type: 'integer' },
            { key: 'horsepower_hp',       label: 'Horsepower (hp)',         type: 'number' },
            { key: 'torque_lbft',         label: 'Torque (lb-ft)',          type: 'number' },
            { key: 'battery_gross_kwh',   label: 'Battery Gross (kWh)',     type: 'number' },
        ],
    },
    {
        key: 'performance',
        label: 'Performance',
        fields: [
            { key: 'zero_to_60_mph_sec', label: '0–60 mph (sec)',       type: 'number' },
            { key: 'top_speed_mph',      label: 'Top Speed (mph)',       type: 'number' },
            { key: 'quarter_mile',       label: 'Quarter Mile',          type: 'text' },
        ],
    },
    {
        key: 'compute',
        label: 'Compute / ADAS',
        fields: [
            { key: 'lidar',           label: 'LIDAR',               type: 'boolean' },
            { key: 'radars',          label: 'Radar Units',         type: 'integer' },
            { key: 'ultrasonics',     label: 'Ultrasonic Sensors',  type: 'integer' },
            { key: 'cameras',         label: 'Cameras',             type: 'integer' },
            { key: 'processing_chip', label: 'Processing Chip',     type: 'text' },
        ],
    },
    {
        key: 'infotainment',
        label: 'Infotainment',
        fields: [
            { key: 'android_auto',     label: 'Android Auto',       type: 'boolean' },
            { key: 'carplay',          label: 'CarPlay',            type: 'boolean' },
            { key: 'operating_system', label: 'Operating System',   type: 'text' },
            { key: 'supported_apps',   label: 'Supported Apps',     type: 'text' },
        ],
    },
    {
        key: 'dimensions',
        label: 'Exterior Dimensions',
        fields: [
            { key: 'weight_lbs',          label: 'Weight (lbs)',            type: 'number' },
            { key: 'length_in',           label: 'Length (in)',             type: 'number' },
            { key: 'width_in',            label: 'Width (in)',              type: 'number' },
            { key: 'height_in',           label: 'Height (in)',             type: 'number' },
            { key: 'wheelbase_in',        label: 'Wheelbase (in)',          type: 'number' },
            { key: 'ground_clearance_in', label: 'Ground Clearance (in)',   type: 'number' },
            { key: 'bed_length_in',       label: 'Truck Bed Length (in)',   type: 'number' },
        ],
    },
    {
        key: 'wheels',
        label: 'Wheels & Tires',
        fields: [
            { key: 'wheel_size_in', label: 'Wheel Size (in)', type: 'integer' },
            { key: 'tire_size',     label: 'Tire Size',       type: 'text' },
        ],
    },
    {
        key: 'suspension',
        label: 'Suspension',
        fields: [
            { key: 'front_type',        label: 'Front Suspension Type',  type: 'text' },
            { key: 'rear_type',         label: 'Rear Suspension Type',   type: 'text' },
            { key: 'adaptive_damping',  label: 'Adaptive Damping',       type: 'boolean' },
            { key: 'adjustable_height', label: 'Adjustable Ride Height', type: 'boolean' },
        ],
    },
    {
        key: 'lighting',
        label: 'Lighting',
        fields: [
            { key: 'adaptive_headlights', label: 'Adaptive Headlights',       type: 'boolean' },
            { key: 'headlight_type',      label: 'Headlight Type',            type: 'enum',
              options: ['LED', 'Laser', 'Matrix LED', 'Pixel LED'] },
            { key: 'auto_high_beam',      label: 'Auto High Beam',            type: 'boolean' },
            { key: 'ambient_lighting',    label: 'Ambient Interior Lighting', type: 'boolean' },
        ],
    },
    {
        // key kept as 'charging' to preserve existing DB data
        key: 'charging',
        label: 'Battery & Charging',
        fields: [
            { key: 'battery_usable_kwh',          label: 'Battery Usable (kWh)',          type: 'number' },
            { key: 'battery_nominal_voltage_v',   label: 'Battery Nominal Voltage (V)',   type: 'number' },
            { key: 'max_dc_kw',                   label: 'Max DC Charge Rate (kW)',        type: 'number' },
            { key: 'max_ac_kw',                   label: 'Max AC Charge Rate (kW)',        type: 'number' },
            { key: 'charge_time_10_to_80_pct_min',label: 'Charge Time 10→80% (min)',       type: 'number' },
            { key: 'charge_port',                 label: 'Charge Port',                   type: 'enum',
              options: ['NACS', 'CCS1', 'CHAdeMO', 'Type 2'] },
            { key: 'v2l',                         label: 'Vehicle-to-Load (V2L)',          type: 'boolean' },
        ],
    },
    {
        key: 'interior',
        label: 'Interior & Comfort',
        fields: [
            { key: 'seating',                  label: 'Seating Capacity',            type: 'integer' },
            { key: 'cargo_cuft',               label: 'Cargo Volume (cu ft)',         type: 'number' },
            { key: 'frunk_cuft',               label: 'Frunk Capacity (cu ft)',       type: 'number' },
            { key: 'max_cargo_cuft',           label: 'Max Cargo, Seats Flat (cu ft)', type: 'number' },
            { key: 'screen_size_in',           label: 'Head Unit Screen Size (in)',   type: 'number' },
            { key: 'hud',                      label: 'Heads-Up Display (HUD)',       type: 'boolean' },
            { key: 'front_heated_seats',       label: 'Front Heated Seats',           type: 'boolean' },
            { key: 'front_ventilated_seats',   label: 'Front Ventilated Seats',       type: 'boolean' },
            { key: 'rear_heated_seats',        label: 'Rear Heated Seats',            type: 'boolean' },
            { key: 'heated_steering_wheel',    label: 'Heated Steering Wheel',        type: 'boolean' },
            { key: 'sound_system_speakers',    label: 'Sound System Speakers',        type: 'integer' },
            { key: 'sound_system_watts',       label: 'Sound System Watts',           type: 'integer' },
        ],
    },
];

/**
 * Normalize a custom field key for consistent storage and comparison:
 * trim whitespace, lowercase, collapse internal whitespace runs to underscores.
 * e.g. "  Gear Ratio  " → "gear_ratio"
 */
export function normalizeCustomKey(raw) {
    return raw.trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * Format a stored custom key for display:
 * replace underscores with spaces, title-case each word.
 * e.g. "gear_ratio" → "Gear Ratio"
 */
export function formatCustomKey(key) {
    return key
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}
