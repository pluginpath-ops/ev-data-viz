import { createContext, useContext } from 'react';

/**
 * In-app navigation that components deep in the tree need, without threading
 * a callback through every layer between App and them (#354): a platform link
 * sits on a vehicle card, in View Specs and in vehicle-table notes.
 *
 * App provides it. Where nothing does — the pop-out window — the value is
 * null and a link falls back to its href.
 *
 *   openPlatform(id)     show a platform's page under Reference
 *   openExplainer(slug)  show an explainer under Reference › Explainers (#355)
 */
export const NavigationContext = createContext({ openPlatform: null, openExplainer: null });

export const useNavigation = () => useContext(NavigationContext);
