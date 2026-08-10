import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  test: {
    // Pure modules only for now: no jsdom, so the suite stays fast enough to
    // run on every save. The wiring suite reads source text rather than
    // rendering, which catches the failure mode a DOM harness would (a util
    // that is correct and never called) without the cost of one.
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
