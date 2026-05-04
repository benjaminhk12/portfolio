# Portfolio Enhancement Ideas

A curated list of improvements and enhancements for the portfolio site (landing page, Finance Timeline, Gravity Playground), organized by area and impact.

## 🎨 UX & Polish
1. **Mobile responsiveness** — finance sidebar and simulator toolbar likely overflow on phones; add breakpoints and a collapsible sidebar.
2. **Keyboard shortcuts** — Space=play/pause, R=reset, Del=delete body in simulator; `/` to focus search, Esc to close modals in finance.
3. **Loading states** — skeleton placeholders before the chart first renders.
4. **Empty-state CTAs** — the finance "no positions" message could include a "Try a sample portfolio" button.
5. **Toast notifications** — confirm save/delete actions (currently silent).
6. **Confirm-on-delete** — finance has no confirmation for "Delete account" (destroys data + keypoints irreversibly).
7. **Theme transition** — fade colors instead of hard-flipping when toggling dark/light.
8. **Respect `prefers-color-scheme`** on first visit instead of defaulting to light.

## 💰 Finance Tool
9. **Undo/redo** for account & keypoint edits.
10. **Import/Export** — JSON download/upload of your portfolio (currently locked in one browser).
11. **CSV export** of the chart data points.
12. **Multiple scenarios** — save/load named "what-if" portfolios side by side.
13. **Inflation toggle** — show real vs nominal values.
14. **Tax/fees model** — capital gains, management fees on investments.
15. **Goal tracking** — "I want $X by date Y" overlay with required contribution.
16. **Monte Carlo / variable returns** — instead of a single fixed rate.
17. **Amortization schedule view** — table of payments → principal/interest split for loans.
18. **Currency/locale config** — currently hard-coded NZD / en-NZ.
19. **Account categories/tags** + filtering in the chart legend.
20. **Data validation** — currently you can enter negative rates, end dates before start dates, etc.

## 🪐 Gravity Simulator
21. **Trails toggle & length slider** — visualize orbits.
22. **Energy/momentum readout** — useful for verifying the integrator.
23. **Time-step & integrator selector** — Verlet vs RK4; speed multiplier.
24. **Barnes–Hut quadtree** — current O(n²) caps you around ~200 bodies; quadtree gets you to thousands.
25. **More presets** — figure-8 three-body, Lagrange points, binary star, galaxy collision.
26. **Add-body-by-drag** — click-drag to set initial velocity vector.
27. **Save/load scene** to localStorage or JSON file.
28. **Recording** — export an MP4/GIF of a simulation run.
29. **Collision modes** — currently only merge; add elastic bounce option.
30. **Reference frames** — center camera on a specific body.

## 🏠 Landing / Portfolio
31. **About / bio section** — the index is currently just two cards.
32. **Project tags & screenshots** — preview thumbnails on each card.
33. **Add more projects** — the structure is now nicely set up to grow.
34. **Contact links** — GitHub, email, LinkedIn footer.
35. **Favicon & social meta tags** (OpenGraph image, description) so links preview nicely.

## 🏗️ Architecture & Code Quality
36. **Build step** — Vite or esbuild to bundle, minify, tree-shake, hash filenames for cache busting.
37. **TypeScript** — finance state and Body class would benefit massively from types.
38. **Unit tests** for `finance-calculations.js` — pure functions, easy wins (Vitest).
39. **State management** — finance globals (`accounts`, `chartRange`, etc.) could move into a small store with subscribe-on-change.
40. **Self-host CDN deps** — avoid third-party CDN downtime / privacy concerns; pinned anyway.
41. **CSP headers / `<meta http-equiv>`** — defense in depth for the XSS surface recently patched.
42. **Storybook-lite component gallery** for shared widgets (modal, theme toggle, sidebar item).
43. **Replace `innerHTML` with `<template>` elements + `cloneNode`** — eliminates the entire XSS class.
44. **Lint/format** — Prettier + ESLint config; pre-commit hook.

## ♿ Accessibility
45. **Theme toggle needs an `aria-label`** and properly labelled `<input type="checkbox">`.
46. **Modals need focus trap + Esc-to-close + `aria-modal`**.
47. **Chart alt-text / data table fallback** for screen readers.
48. **Color-blind safe palette option** (current account colors may not be distinguishable).
49. **Keyboard reachability** of the gravity canvas (right now mouse-only).
50. **Increase contrast ratios** in dark mode (verify with axe).

## ⚡ Performance
51. **Virtualize long account/body lists** (only matters at scale).
52. **Throttle simulator render to `requestAnimationFrame`** with delta-time clamp on tab switch.
53. **`OffscreenCanvas` + Web Worker** for physics — keeps UI thread free.
54. **Cache `compoundValue` results** per (account, date) when keypoints don't change.
55. **Lazy-load Chart.js** — only on the finance page (already true), but consider deferring until first interaction.

## 🚀 Deployment & DX
56. **GitHub Actions** — deploy to GitHub Pages on push, run lint/tests.
57. **`README.md`** — currently no project README; describe each tool with screenshots.
58. **License file** (MIT?).
59. **Lighthouse CI** in PRs to catch perf/a11y regressions.
60. **Analytics** (privacy-friendly, e.g. Plausible) to see what people actually use.

---

## ⭐ Top-5 Recommendations
If only a handful are tackled, prioritize these:

1. **Import/Export JSON for finance** (#10) — protects user data
2. **Confirm-on-delete** (#6) + **data validation** (#20) — prevents accidental data loss
3. **Mobile responsiveness** (#1)
4. **Tests for `finance-calculations.js`** (#38) — the math is the riskiest code
5. **README + favicon + meta tags** (#57, #35) — cheap and high-visibility
