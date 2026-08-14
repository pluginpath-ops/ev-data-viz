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
  test: {
    // Pure modules only for now: no jsdom, so the suite stays fast enough to
    // run on every save. The wiring suite reads source text rather than
    // rendering, which catches the failure mode a DOM harness would (a util
    // that is correct and never called) without the cost of one.
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
