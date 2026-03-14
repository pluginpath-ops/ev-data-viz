# Project Guidelines

## Architecture & Code Style

### Modularity and Reusability
Strive for modular, reusable components. When a piece of UI or logic is used in more than one place — or is likely to be reused in the future — extract it into its own component file rather than duplicating it inline.

**Example:** `EditVehicleForm` was extracted from `VehiclesView` into `src/components/EditVehicleForm.jsx` so it could be shared with `RunsView` without duplication.

Prefer:
- One component per file for anything beyond a trivial helper
- Module-level (not inline) component definitions to avoid React remounting on every render
- Shared hooks in `src/hooks/`, shared utilities in `src/utils/`

### CSS
- Use semantic class names defined in `src/index.css` via Tailwind's `@apply` directive
- Class names should describe *what* an element is, not *how* it looks (e.g. `.vehicle-grid`, `.modal-overlay`)
- Avoid repeating long Tailwind utility clusters inline; extract them to named classes

### Tech Stack
- React 19 + Vite + Tailwind CSS v4 (`@tailwindcss/vite`, CSS-first, no `tailwind.config.js`)
- Supabase for auth and data
