import { createContext, useContext } from 'react';

/**
 * The featured comparisons (#448), and the ways to make or change one, for the
 * components that need them without threading props through App: Home draws
 * them, and a chart's toolbar offers "Save as featured comparison".
 *
 * App provides it. The list is loaded once there, so Home and the editor never
 * hold two copies that disagree about what was just saved. Where nothing
 * provides it — the pop-out — nothing can be curated and the list is empty.
 *
 *   comparisons      what the reader may see: listed ones, and for a curator the rest
 *   loading, error   the list's load
 *   canCurate        whether this reader may make and edit them (admin, contributor)
 *   canDelete        whether this reader may delete one (admin)
 *   openEditor(req)  open the editor: { comparison } to change one, or
 *                    { add: { title, params }, vehicleIds } to put a chart in one
 *   featureThisChart()  open the editor for the chart on screen; null when there is none
 */
export const FeaturedComparisonsContext = createContext({
    comparisons: [], loading: false, error: null,
    canCurate: false, canDelete: false,
    openEditor: null, featureThisChart: null,
});

export const useFeaturedComparisonsContext = () => useContext(FeaturedComparisonsContext);
