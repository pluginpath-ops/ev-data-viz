import { useRef, useEffect, useCallback } from 'react';

const CHANNEL = 'evbench-chart-sync';

/**
 * Syncs chart state between the main tab and any pop-out presentation windows
 * using the BroadcastChannel API.
 *
 * Main tab: broadcasts state on every change; responds to 'request-state' from new pop-outs.
 * Pop-out tab: sends 'request-state' on mount + focus, applies received state.
 */
export function useChartSync({
    chartMode, chartConfig, selectedVehicles, compareConfig, roadTripConfig, epaConfig, pairings,
    setChartMode, setChartConfig, setVehicleSelection, setCompareConfig, setRoadTripConfig, setEpaConfig, setPairings,
}) {
    const isPopout = useRef(
        new URLSearchParams(window.location.search).get('popout') === '1'
    ).current;

    const channelRef = useRef(null);

    // Keep a ref of current state so the onmessage handler never closes over stale values
    const stateRef = useRef({ chartMode, chartConfig, selectedVehicles, compareConfig, roadTripConfig, epaConfig, pairings });
    useEffect(() => {
        stateRef.current = { chartMode, chartConfig, selectedVehicles, compareConfig, roadTripConfig, epaConfig, pairings };
    });

    useEffect(() => {
        if (!('BroadcastChannel' in window)) return;

        const channel = new BroadcastChannel(CHANNEL);
        channelRef.current = channel;

        if (isPopout) {
            // Pop-out: receive state pushes from main tab
            channel.onmessage = ({ data }) => {
                if (data?.type !== 'chart-state') return;
                setChartMode(data.chartMode);
                setChartConfig(data.chartConfig);
                setVehicleSelection(data.selectedVehicleIds);
                if (data.compareConfig)  setCompareConfig(data.compareConfig);
                if (data.roadTripConfig) setRoadTripConfig(data.roadTripConfig);
                if (data.epaConfig)      setEpaConfig(data.epaConfig);
                // Pairings decide which range test prices the miles, so a pop-out
                // that missed them would plot different numbers than the tab that
                // opened it, with nothing on screen saying so. Assigned even when
                // empty, unlike the configs above — {} is a meaningful state here.
                if (data.pairings)       setPairings(data.pairings);
            };
            // Request current state on mount and whenever the tab regains focus
            // (covers the case where the main tab refreshed while this was in the background)
            const request = () => channel.postMessage({ type: 'request-state' });
            request();
            window.addEventListener('focus', request);
            return () => {
                channel.close();
                window.removeEventListener('focus', request);
            };
        } else {
            // Main tab: respond to state requests from pop-outs
            channel.onmessage = ({ data }) => {
                if (data?.type !== 'request-state') return;
                const { chartMode, chartConfig, selectedVehicles, compareConfig, roadTripConfig, epaConfig, pairings } = stateRef.current;
                channel.postMessage({
                    type: 'chart-state',
                    chartMode,
                    chartConfig,
                    selectedVehicleIds: selectedVehicles,
                    compareConfig,
                    roadTripConfig,
                    epaConfig,
                    pairings,
                });
            };
            return () => channel.close();
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally one-time setup

    /** Called by App.jsx whenever chart state changes (main tab only). */
    const sendState = useCallback(() => {
        if (isPopout || !channelRef.current) return;
        const { chartMode, chartConfig, selectedVehicles, compareConfig, roadTripConfig, epaConfig, pairings } = stateRef.current;
        channelRef.current.postMessage({
            type: 'chart-state',
            chartMode,
            chartConfig,
            selectedVehicleIds: selectedVehicles,
            compareConfig,
            roadTripConfig,
            epaConfig,
            pairings,
        });
    }, [isPopout]);

    return { isPopout, sendState };
}
