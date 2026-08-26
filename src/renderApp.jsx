/**
 * Mounts the app. Split out of main.jsx so the whole component graph — and with
 * it constants/epa.js — is loaded only AFTER the published model constants have
 * seeded the resolver. See the note at the top of main.jsx.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppProvider } from './context/AppContext';
import App from './App';

export function renderApp() {
    ReactDOM.createRoot(document.getElementById('root')).render(
        <React.StrictMode>
            <AppProvider>
                <App />
            </AppProvider>
        </React.StrictMode>
    );
}
