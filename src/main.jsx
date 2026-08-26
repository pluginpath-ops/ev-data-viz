/**
 * Entry point — and the constants bootstrap (#261).
 *
 * The published model constants have to be in place BEFORE constants/epa.js is
 * evaluated, because it resolves every tunable at module load. That property is
 * what keeps the math modules plain static imports, so rather than give it up
 * this file loads nothing that could reach them: the app is pulled in
 * dynamically, after the seed.
 *
 * Everything imported statically here must stay a leaf (CSS, the typography
 * knobs, the settings fetch, the override store). Adding a static import of a
 * component, the context, or DataService would evaluate constants/epa.js first
 * and silently pin the whole site to its compiled defaults — a failure with no
 * error, only wrong numbers.
 */
import './index.css';
import { applyTypographyOverrides } from './styles/typographyKnobs';
import { fetchSiteSettingsForBootstrap, MODEL_CONSTANTS_KEY } from './services/siteSettings';
import { seedSiteConstants, parseSiteConstants } from './constants/overrides';

// Apply per-browser typography overrides before first paint (no-op if none set).
applyTypographyOverrides();

fetchSiteSettingsForBootstrap()
    .then(settings => {
        seedSiteConstants(parseSiteConstants(settings[MODEL_CONSTANTS_KEY]));
        return import('./renderApp');
    })
    .then(({ renderApp }) => renderApp());
