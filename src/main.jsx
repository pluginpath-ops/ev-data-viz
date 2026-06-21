import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppProvider } from './context/AppContext';
import App from './App';
import './index.css';
import { applyTypographyOverrides } from './styles/typographyKnobs';

// Apply per-browser typography overrides before first paint (no-op if none set).
applyTypographyOverrides();

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <AppProvider>
            <App />
        </AppProvider>
    </React.StrictMode>
);
