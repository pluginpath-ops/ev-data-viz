import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    // Honour PORT so a second concurrent session can still get a dev server.
    // Bare `vite` ignores PORT and hunts for the next free port on its own
    // (5173 → 5174), which breaks browser-preview tooling: the proxy is told
    // the port it assigned, nothing ever binds there, and every navigation
    // fails while vite cheerfully logs "ready".
    port: Number(process.env.PORT) || 5173,
  },
  build: {
    rollupOptions: {
      output: {
        // Split the three large dependencies out of the app chunk. This does not
        // reduce first-load bytes — every one of them is needed to render the
        // first screen — it changes how they are CACHED. With /assets/* now
        // served immutable, a deploy that only touches app code leaves these
        // three URLs unchanged, so returning visitors re-download ~180KB of app
        // instead of the whole 400KB bundle.
        //
        // Deliberately NOT split by view: tab switching must never wait on a
        // fetch, so all views and charts stay in the eager app chunk. The
        // deferred set is utilities only — see components/lazyComponents.js.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          // pdfjs-dist is already dynamically imported by utils/extractPdfText.
          // Naming a chunk here would pull it back into the static graph.
          if (id.includes('pdfjs-dist')) return;
          if (id.includes('chart.js') || id.includes('chartjs')) return 'vendor-charts';
          if (id.includes('@supabase') || id.includes('realtime-js')) return 'vendor-supabase';
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/')) {
            return 'vendor-react';
          }
        },
      },
    },
  },
  test: {
    // Pure modules only for now: no jsdom, so the suite stays fast enough to
    // run on every save. The wiring suite reads source text rather than
    // rendering, which catches the failure mode a DOM harness would (a util
    // that is correct and never called) without the cost of one.
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
