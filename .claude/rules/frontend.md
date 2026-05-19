---
paths:
  - "frontend/src/**"
---

# Frontend

> Before writing or restyling any frontend code, invoke the `anthropic-skills:frontend-design` skill. It enforces design-quality conventions for Tailwind/shadcn projects and avoids generic AI aesthetics.

## Stack (don't introduce alternatives)

- **CSS:** Tailwind 4 (`@tailwindcss/vite`) — use Tailwind utilities. No CSS Modules, no styled-components.
- **Primitives:** shadcn/ui + Radix (`radix-ui`). Don't mix in Headless UI, Mantine, Chakra, etc.
- **Icons:** `lucide-react`. Don't add a second icon set.
- **Date utilities:** `date-fns`.
- **State:** No state library. State lives in `App.tsx` and is passed as props. Don't introduce Redux/Zustand/Jotai.

## Design tokens (single source of truth)

**All colors and custom CSS variables — new and existing — belong in `frontend/src/index.css`.** If a color is currently hardcoded in a component (inline style, arbitrary Tailwind value, or raw hex/oklch), migrate it to a CSS custom property there.

- Define tokens under `:root` and `.dark` following the shadcn/ui convention (e.g. `--my-token: oklch(...)`).
- Expose them via `@theme inline` so Tailwind references them as `bg-my-token`, `text-my-token`, etc.
- Verify legibility in both light and dark mode before committing.

## Tailwind conventions

- Use `size-*` instead of paired `w-* h-*` when width and height match (e.g. `size-4`, not `w-4 h-4`).
- Mobile-first: design at the smallest viewport and layer `sm:` / `md:` / `lg:` / `xl:` upward.
- No arbitrary values for colors. If a token doesn't exist for what you need, add one to `index.css`.

## Layout

- CSS Grid for 2D, Flexbox for 1D. Use `gap`, not margin hacks.
- Semantic HTML: `<header>`, `<nav>`, `<main>`, `<section>`, `<article>`, `<footer>`.
- Touch targets minimum 44×44 px.

## Accessibility (non-negotiable)

- All interactive elements keyboard-accessible.
- Images: meaningful `alt` text. Decorative: `alt=""`.
- Form inputs: associated `<label>` or `aria-label`.
- Contrast: 4.5:1 normal, 3:1 large text. Verify both themes.
- Visible focus indicators. Never `outline: none` without a replacement.
- Color never the sole indicator.
- Respect `prefers-reduced-motion` and `prefers-color-scheme`.

## Separation of concerns

- LLM response parsing is **client-side in `frontend/src/lib/parser.ts`**. Components must not parse LLM JSON.
- HTTP I/O is in `frontend/src/lib/api.ts`. Components must not call `fetch` directly.
- Shared types live in `frontend/src/lib/types.ts`. Don't redeclare interfaces in components.
- A tag component should not reach into the global dictionary to resolve an alias — the resolved value should be passed down as a prop (Law of Demeter).
