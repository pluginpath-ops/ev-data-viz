/**
 * THE SETUP WIZARD'S CONTENT — every word, option, cut-off and default it uses.
 * Edit this file to tailor the wizard; the logic (utils/setupWizard.js) and the
 * screens (components/setup/) read it and hold no content of their own.
 *
 * Units are canonical everywhere here: miles, mph, °F, feet, US dollars. The
 * wizard converts for a reader on metric; never write km or °C in this file.
 *
 * Sections:
 *   steps         which screens exist, in order, and each one's title. Keys:
 *                 goal, cars, driving, weather, money, summary (summary last).
 *   entry         the button text: Home and an empty chart ("Set up for me",
 *                 Home's with a Beta badge), and the nav's button ("Guide me").
 *   goals         "What do you want to know?" — the reader may pick several.
 *                 Each opens one chart `mode` (a mode key from
 *                 constants/chartNav.js) and `asks` only the questions that
 *                 chart reads. The questions asked are every chosen goal's
 *                 `asks` together, in step order; a step left with no
 *                 question is skipped. `default` is the goal of a reader who
 *                 skips. Question keys: cars, dailyMi, highway, speedMph,
 *                 tripMi, climate, mountains, home, homePrice, gasMpg,
 *                 gasPrice. An optional `chart` sets that chart's axes and
 *                 limits on Apply (see the charging goal).
 *   cars          the "Which cars?" step and the starter sets ("kinds of car").
 *                 `size` caps how many a set selects. `requireData` — a vehicle
 *                 needs all of these (from utils/vehicleDataCategories.js) to be
 *                 suggested. `curated` is an optional list of vehicle ids (numbers)
 *                 that go first, in that order; the Vehicles & Specs order fills
 *                 the rest. `match` is a rule, as data:
 *                   {}                                   every vehicle
 *                   { tag: ['SUV', 'CUV'] }              has any of these tags
 *                   { field: 'priceUsd', op: '<=', value: 45000 }
 *                        fields: priceUsd (base price, $), lengthIn (length, in)
 *                        ops: '<', '<=', '>', '>=' (a blank field never matches)
 *                   { any: [rule, …] }  { all: [rule, …] }  { not: rule }
 *   driving       daily miles, town/highway share, highway speeds (mph, on a
 *                 5 mph grid), road-trip distance (miles, for Road Trip only).
 *                 `commuterWeek` is the Cost & Time week the cost goal always
 *                 sets: Cost & Time prices one typical week, so a road trip a
 *                 few times a year has no place in it.
 *                 Week letters: D daily, L long day, O off; Monday first.
 *   weather       climates: winter and summer °F and how many months are
 *                 winter. The charts are corrected to the HARDER of the two
 *                 seasons, worked out from the correction model, not set here.
 *                 `mountains.ft` is the altitude "Mountains" means.
 *   money         home charging (each option's `level` is an index into
 *                 HOME_LEVELS in constants/costToDrive.js; 6 = no home charging)
 *                 and the number fields' limits and hints.
 *   summary       the labels on the last screen.
 *   reviewBar     the bar after Apply that lists the chosen charts, with
 *                 Next, Change answers and a close ×. Its season switch is
 *                 `season` (the label) and one option per season, `option`
 *                 with {season} {temp} filled in, winter first; `harder` is
 *                 the hover note on the harder one.
 *
 * Check a change:  npx vitest run src/utils/__tests__/setupWizard.test.js
 * (it validates this file and says what is wrong).
 *
 * Plain data only — no functions.
 */
export const SETUP_WIZARD = {
    steps: [
        { key: 'goal',    title: 'What do you want to know?' },
        { key: 'cars',    title: 'Which cars?' },
        { key: 'driving', title: 'How do you drive?' },
        { key: 'weather', title: "What's the weather like?" },
        { key: 'money',   title: 'Charging and costs' },
        { key: 'summary', title: "Here's what we'll set" },
    ],

    entry: {
        button: 'Set up for me',
        beta: 'Beta',            // the badge beside Home's button while the wizard is new; '' hides it
        home: 'New here? Answer a few questions and we’ll set up the charts for you.',
        emptyChart: 'Not sure what to pick?',
        nav: 'Guide me',
    },

    goals: {
        question: 'Pick one or more.',
        default: 'cost',
        options: [
            // Cost & Time prices a whole week: every driving, weather and money answer feeds it.
            { key: 'cost',     label: 'What it costs to run', detail: 'Per month, against a gas car', mode: 'drivecost',
              asks: ['cars', 'dailyMi', 'highway', 'speedMph', 'climate', 'mountains', 'home', 'homePrice', 'gasMpg', 'gasPrice'] },
            // Range & Efficiency corrects every test to a speed, temperature and altitude.
            { key: 'range',    label: 'How far it goes',      detail: 'Real highway range',           mode: 'range',
              asks: ['cars', 'speedMph', 'climate', 'mountains'] },
            // Charging Curves opens on time from 10% against range, capped at an
            // hour; the range axis is corrected to the speed and weather.
            // `chart` sets the chart itself: xAxis / yAxis / y2Axis are axis keys
            // from utils/chargingAxes.js (y2Axis: 'chargeRate' adds kW on a second
            // axis — left off as too much for a newcomer), raceThreshold the SoC
            // the time axis starts from, axisLimits any of xMin xMax yMin yMax.
            { key: 'charging', label: 'How fast it charges',  detail: 'On a fast charger',            mode: 'charging',
              asks: ['cars', 'speedMph', 'climate', 'mountains'],
              chart: { xAxis: 'time', yAxis: 'range', y2Axis: null, raceThreshold: 10, axisLimits: { xMax: 60 } } },
            // Road Trip drives its own speed and distance, corrected to the weather.
            { key: 'roadtrip', label: 'Road trips',           detail: 'Total time, stops and all',    mode: 'roadtrip',
              asks: ['cars', 'speedMph', 'tripMi', 'climate', 'mountains'] },
            // The table's opening columns (Overview) hold no corrected or priced figure.
            { key: 'specs',    label: 'Specs side by side',   detail: 'Price, size, battery…',        mode: 'specstable',
              asks: ['cars'] },
        ],
    },

    cars: {
        size: 5,
        default: 'popular',
        requireData: ['epa', 'charging', 'range'],
        onePerModel: true,
        ways: {
            keep: { label: 'Keep my {n} selected', addLabel: '＋ Add another car…' },
            pick: { label: 'I know which cars', detail: 'Search by name', addLabel: '＋ Add a car…' },
            set:  { label: 'Suggest some', detail: 'Pick a kind of car' },
        },
        kindsQuestion: 'What kind of car?',
        preview: "We'd pick: {names}",
        previewEmpty: 'None of these have charging, range and EPA data yet.',
        kinds: [
            { key: 'small-suv', label: 'Small SUV', curated: [],
              match: { any: [{ tag: ['CUV', 'Crossover'] }, { all: [{ tag: ['SUV'] }, { field: 'lengthIn', op: '<', value: 186 }] }] } },
            { key: 'suv', label: 'Family SUV', curated: [],
              match: { all: [{ tag: ['SUV'] }, { not: { tag: ['CUV', 'Crossover'] } }, { not: { field: 'lengthIn', op: '<', value: 186 } }] } },
            { key: 'sedan',      label: 'Sedan',        curated: [], match: { tag: ['Sedan', '4-door'] } },
            { key: 'small-car',  label: 'Small car',    curated: [], match: { tag: ['Hatch'] } },
            { key: 'pickup',     label: 'Pickup',       curated: [], match: { tag: ['Truck'] } },
            { key: 'luxury',     label: 'Luxury',       curated: [], match: { field: 'priceUsd', op: '>=', value: 70000 } },
            { key: 'affordable', label: 'Under $45k',   curated: [], match: { field: 'priceUsd', op: '<=', value: 45000 } },
            { key: 'popular',    label: 'Most popular', curated: [], match: {} },
        ],
    },

    driving: {
        dailyMi: { label: 'Miles on a normal day', labelMetric: 'Kilometers on a normal day', min: 5, max: 400, step: 5, hint: 40 },
        commuterWeek: 'DDDDDOO',
        highway: {
            label: 'Where',
            options: [
                { key: 'town',    label: 'Mostly town',    highwayPct: 20 },
                { key: 'mix',     label: 'A mix',          highwayPct: 50 },
                { key: 'highway', label: 'Mostly highway', highwayPct: 80 },
            ],
        },
        speed: { label: 'Highway speed', mph: [65, 70, 75, 80] },
        tripMi: { label: 'A typical road trip', miles: [200, 400, 700] },
    },

    weather: {
        climates: [
            { key: 'mild',    label: 'Mild',    region: 'Pacific Northwest',       winterF: 40, summerF: 80, winterMonths: 4 },
            { key: 'hot',     label: 'Hot',     region: 'South',                   winterF: 45, summerF: 95, winterMonths: 2 },
            { key: 'cold',    label: 'Cold',    region: 'Northern Plains, Canada', winterF: 0,  summerF: 80, winterMonths: 6 },
            { key: 'extreme', label: 'Extreme', region: 'Midwest, Northeast',      winterF: 15, summerF: 95, winterMonths: 4 },
        ],
        climateDetail: '{winter} winter · {summer} summer',
        mountains: { label: 'Altitude', low: 'Near sea level', high: 'Mountains (~{alt})', ft: 5000 },
    },

    money: {
        home: {
            options: [
                { key: 'wall48',    label: 'Wall charger',      detail: '240 V, 48 A',          level: 4 },
                { key: 'outlet240', label: '240 V outlet',      detail: '240 V, 32 A',          level: 3 },
                { key: 'outlet120', label: 'Normal outlet',     detail: '120 V, 12 A',          level: 0 },
                { key: 'none',      label: 'No home charging',  detail: 'Public chargers only', level: 6 },
            ],
        },
        homePrice: { label: 'Electricity at home',    min: 0,    max: 1,    step: 0.01, hint: 0.17, prefix: '$', unit: '/ kWh' },
        gasMpg:    { label: "Your gas car's mileage", min: 5,    max: 60,   step: 1,    hint: 25,   unit: 'mpg' },
        gasPrice:  { label: 'Gas price',              min: 1,    max: 8,    step: 0.01, hint: 3.20, prefix: '$', unit: '/ gal' },
    },

    summary: {
        opens: 'Opens',
        cars: 'Cars',
        carsKept: 'the ones you have selected',
        carsKeptPlus: 'your {n}, plus {added} added',
        carsPicked: '{n} you picked',
        carsSuggested: '{kind}, {n} suggested',
        carsNone: 'none match — pick some yourself',
        driving: 'Driving',
        perDay: '{d} a day',
        highwaySpeed: '{s} on the highway',
        tripLength: 'road trips of ~{d}',
        weather: 'Weather',
        season: '{season}, {temp} (your harder season)',
        charging: 'Charging',
        gas: 'Gas car',
        unset: 'Not set (no setting for it yet): {list}.',
        footer: 'Anything you skipped stays as it is. You can change it all later.',
    },

    reviewBar: {
        title: 'Your charts',
        next: 'Next ›',
        change: 'Change answers',
        close: 'Close',
        season: 'Season',
        option: '{season} {temp}',
        harder: 'Your harder season — the charts start here',
    },
};
