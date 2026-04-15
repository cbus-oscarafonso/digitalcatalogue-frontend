# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development

**Serve locally:**
```bash
npx serve .
```
`serve.json` configures a redirect from `/` to `/client-area.html`.

**Build search index** (requires Python 3, no external deps):
```bash
# Windows
build-index.bat

# Any platform
python tools/build_search_index.py
```
Scans `assets/svgs/*.svg`, parses BOM tables, and writes `assets/search-index.json`.

## Architecture

This is a **no-build, vanilla JS/HTML/CSS** frontend. There is no npm, no bundler, no framework. All pages are static `.html` files with `<script>` tags loading plain `.js` files.

### Supabase backend

All persistence goes through [Supabase](https://supabase.com):
- **Auth**: email/password + invite flow
- **Database**: `profiles`, `customers`, `catalogs`, `vehicle_catalogs`, order requests
- **Storage**: catalog SVGs and thumbnails in the `catalogs` bucket under `catalogs/{paiCode}/`

The global Supabase client is `window.sb`, initialized in `supabase-client.js`. Every page loads the Supabase CDN script first, then `supabase-client.js`.

### Script loading order (all protected pages)

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="supabase-client.js"></script>   <!-- sets window.sb -->
<script src="auth-guard.js"></script>         <!-- sets window.requireAuth -->
<script src="toast.js"></script>              <!-- sets window.toast -->
<script src="user-badge.js"></script>         <!-- sets window.renderUserBadge -->
```

### Auth & access control

`auth-guard.js` exposes `window.requireAuth()`. Every protected page calls it on load. It:
1. Waits up to 2 s for `window.sb` to be ready
2. Gets the Supabase session
3. Checks `profiles.status === 'active'` — any other status (pending, blocked, missing) redirects to `login.html`

Pages start with `html { visibility: hidden }` and call `window.revealPage()` after auth passes to prevent flash of unauthenticated content.

BFCache (back/forward navigation) re-runs the auth + status check via a `pageshow` event listener in `auth-guard.js`.

### User roles

Roles live in `profiles.role`:
- `admin` — can access `admin-approval.html`, invite users, manage profiles
- `catalog_manager` — can access `catalog-manager.html`
- `client_manager` — internal staff managing customers
- `internal` — internal user
- `customer` — external customer, scoped to a `customer_id`

### Pages and their JS files

| Page | JS |
|---|---|
| `index.html` | inline (detects password recovery, redirects to `client-area.html`) |
| `client-area.html` | `client-area.js` + `order-request.js` |
| `interactive-catalog.html` | `app.js` + `order-request.js` |
| `catalog-manager.html` | `catalog-manager.js` |
| `admin-approval.html` | `admin-approval.js` |
| `search.html` | `search.js` |
| `login.html` | inline |
| `reset-password.html` | inline |

### Shared utilities

- `toast.js` — `window.toast(msg)`, `toast.success()`, `toast.error()`, `toast.info()`. Requires `<div id="toast" class="toast">` in the page.
- `user-badge.js` — `window.renderUserBadge(session, preloadedProfile)`. Renders into `#userBadge`.
- `logout.js` — binds `#btnLogout` click to `sb.auth.signOut()` + redirect.
- `order-request.js` — shared cart rendering logic used by both `client-area.html` and `interactive-catalog.html`.
- `paths.js` — ES module with URL helpers for Supabase Storage paths (SVGs, thumbnails).

### Catalog storage layout

```
catalogs/{paiCode}/
  pai_{paiCode}.svg       ← root assembly SVG
  svg/{componentCode}.svg ← sub-assembly SVGs
  thumb/{partNo}.jpg      ← part thumbnails
  search-index.json       ← per-catalog search index (built by Python tool)
```

The global `assets/search-index.json` is built locally from `assets/svgs/` for a legacy single-catalog search flow.

### Catalog manager RPCs

`catalog-manager.js` never writes to `catalogs` or `vehicle_catalogs` directly. It uses atomic Supabase RPCs:
- `create_catalog_with_vehicles`
- `update_catalog_and_vehicles`
