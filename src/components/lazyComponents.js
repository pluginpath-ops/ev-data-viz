import { lazy } from 'react';

/**
 * The lazily-loaded set, in one place so it is reviewable as a policy rather
 * than scattered across the components that happen to open them.
 *
 * The policy: **views stay eager, utilities go lazy.**
 *
 * Every tab-level view and every chart is imported normally, because switching
 * tabs should never wait on a network fetch — that is the interaction users
 * perform constantly and it has to feel instant. What is deferred here is the
 * other kind of thing: importers, editors and one-off wizards, opened by an
 * explicit click, by a fraction of visitors, at most a handful of times each.
 * A first-time click on one of these pays a chunk fetch; the reward is that
 * nobody pays for all of them on every cold load.
 *
 * EditVehicleForm carries react-image-crop and its stylesheet, which is why an
 * edit form appears in a list otherwise made of modals.
 *
 * Render these through LazyBoundary, and keep the mount conditional *outside*
 * the boundary so the chunk is not requested until the thing is actually opened.
 */

// Opened from VehiclesView / RunsView by contributors and admins only.
export const EditVehicleForm = lazy(() => import('./EditVehicleForm'));
export const ImportVehiclesModal = lazy(() => import('./ImportVehiclesModal'));

// Admin import wizards.
export const ImportTableauModal = lazy(() => import('./ImportTableauModal'));
export const EpaImportModal = lazy(() => import('./EpaImportModal'));

// Also opened per-vehicle from EpaVehicleSection. Its pdf.js dependency is
// already a dynamic import inside extractPdfText, so this defers the modal's own
// weight, not the parser's.
export const EpaPdfImportModal = lazy(() => import('./EpaPdfImportModal'));

// Performance-tab importers, opened from PerformanceVehicleSection.
export const PerformanceImportModal = lazy(() => import('./PerformanceImportModal'));
export const PastePublishedResultsModal = lazy(() => import('./PastePublishedResultsModal'));
