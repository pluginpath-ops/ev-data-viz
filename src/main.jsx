/**
 * Entry point — and the constants bootstrap (#261).
 *
 * The published model constants have to be in place BEFORE constants/epa.js is
 * evaluated, because it resolves every tunable at module load. That property is
 * what keeps the math modules plain static imports, so rather than give it up
 * this file loads nothing that could reach them: the app is pulled in
 * dynamically, after the seed.
 *
 * Everything imported statically here must stay a leaf (CSS, the theme
 * bootstrap, the typography knobs, the settings fetch, the override store, the short link). Adding a static import of a
 * component, the context, or DataService would evaluate constants/epa.js first
 * and silently pin the whole site to its compiled defaults — a failure with no
 * error, only wrong numbers.
 */
import './index.css';
import { startTheme } from './styles/themeBootstrap';
import { applyTypographyOverrides } from './styles/typographyKnobs';
import { fetchSiteSettingsForBootstrap, MODEL_CONSTANTS_KEY } from './services/siteSettings';
import { seedSiteConstants, parseSiteConstants } from './constants/overrides';
import { expandShortLink } from './utils/shortLink';

// A short link (?k=1.…, #476) is opened out into the readable chart link before
// anything reads the address, so every reader of it — the tab, the chart, the
// pop-out check — sees one form. A key that cannot be read leaves the page on
// Home, and the message rides history.state for App to show.
const shortLink = expandShortLink(window.location.search);
if (shortLink) {
    const { search, error } = shortLink;
    history.replaceState(error ? { shortLinkError: error } : null, '',
        `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`);
}

// Set data-theme before first paint, and keep it in step with the device and
// with the reader's choice in another window. Until this runs :root (light)
// wins, so a reader in dark would see the page flash white on every cold load.
startTheme();

// Apply per-browser typography overrides before first paint (no-op if none set).
applyTypographyOverrides();

fetchSiteSettingsForBootstrap()
    .then(settings => {
        seedSiteConstants(parseSiteConstants(settings[MODEL_CONSTANTS_KEY]));
        return import('./renderApp');
    })
    .then(({ renderApp }) => renderApp());
