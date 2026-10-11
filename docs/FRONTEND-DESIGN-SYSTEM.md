# Frontend Design System

## Status

This document is the frontend redesign reference for BIMANTARA MOTOR INDONESIA. It describes the verified application structure and the approved direction for the shared layout redesign. It is documentation only; it does not change routing, authorization, API contracts, database behavior, or business rules.

Items marked **Recommendation** are implementation guidance, not existing source behavior. Items marked **Decision Needed** require confirmation before they are treated as fixed product requirements.

## 1. Brand Identity

### Brand name

The user-facing brand name is:

```text
BIMANTARA MOTOR INDONESIA
```

The previous visible name `Project Bengkel` must not be used in new user-facing Login or Beranda UI. Existing technical identifiers and internal project references remain unchanged.

### Logo asset

The verified repository asset is:

```text
public/brand/bimantara-motor-indonesia.jpg
```

Use it through the public URL:

```text
/brand/bimantara-motor-indonesia.jpg
```

Rules:

- Use the original asset; do not redraw, crop, or replace the logo.
- Preserve the original aspect ratio.
- Use `object-contain` when the logo is placed in a bounded container.
- Do not stretch the logo to fill a rectangular area.
- Do not crop the logo with `object-cover`.
- Keep a white or visually quiet background behind the JPG asset.
- Provide meaningful alternative text: `BIMANTARA MOTOR INDONESIA`.
- Use a maximum width and height so the logo remains readable without dominating operational screens.
- Recheck the logo at desktop and mobile widths before approving a final size.

The current asset is JPG, so transparency must not be assumed. A dedicated favicon or alternate icon format is outside this design-system document unless a later batch explicitly adds it.

## 2. Design Tokens

The following tokens are the approved starting palette. They should be represented with existing Tailwind utility classes or CSS variables if shared values are needed. No UI dependency is required.

| Token | Value | Usage |
| --- | --- | --- |
| `brand-primary` | `#D71920` | Primary actions, active navigation, key accents |
| `brand-dark` | `#A80F16` | Hover/pressed primary actions, dark red emphasis |
| `ink` | `#171717` | Headings, brand text, high-contrast content |
| `surface` | `#FFFFFF` | Cards, panels, forms, tables |
| `page-background` | `#F5F5F5` | Main application background |
| `border` | `#D9D9D9` | Card, table, form, and divider borders |
| `text-secondary` | `#666666` | Supporting text, descriptions, metadata |

Rules:

- Use red for actions and state emphasis, not as a large page background.
- Use black for strong identity and headings.
- Use white surfaces over the neutral page background.
- Use borders to separate operational regions without excessive shadows.
- Keep status colors distinct from the brand red when status semantics require it. For example, success, warning, and error states must remain distinguishable from a generic primary action.
- Existing business meaning must not be inferred from color alone.

The exact final contrast treatment for every state is a **Recommendation** to validate during implementation with accessibility checks.

## 3. Typography

The verified global font is currently defined in `src/app/globals.css` as:

```css
Arial, Helvetica, sans-serif
```

No new font dependency is planned.

### Hierarchy

- Page title: large, bold, black; one primary title per work area.
- Section title: semibold, compact, used for operational groups and cards.
- Card title: semibold, smaller than the page title.
- Body text: regular, high contrast, readable at normal browser size.
- Supporting text: `#666666`; use for timezone, helper text, descriptions, and metadata.
- Form labels: medium weight and always associated with their input.
- Financial figures: right-aligned in tables; use tabular-looking alignment and consistent currency formatting already provided by the application.
- Quantities and stock values: right-aligned where shown in tabular data.
- Identifiers and document numbers: left-aligned unless the surrounding table convention requires otherwise.

Do not change financial formatting, quantity formatting, date formatting, or report calculations as part of layout work.

## 4. Verified Application Structure

### Root layout

`src/app/layout.tsx` is the only current App Router layout. It provides metadata, imports `globals.css`, and renders the document body. There is no authenticated nested layout yet.

### Login

- Route: `/`
- Page: `src/app/page.tsx`
- Client form: `src/components/login-form.tsx`
- Behavior: redirects an existing session to `/ganti-password` or `/beranda`.
- Layout rule: Login is a standalone screen and must not receive the operational sidebar.

### Beranda

- Route: `/beranda`
- Page: `src/app/beranda/page.tsx`
- Current behavior: server-side session check, brand block, logout, and inline navigation links.
- Planned layout role: authenticated landing page inside the shared shell, with duplicated inline navigation reduced or removed only after sidebar navigation is proven equivalent.

### Authenticated pages

Current pages are Server Components that perform their own session and role checks, then render client components where needed:

| Route | Page responsibility | Main client component | Access behavior |
| --- | --- | --- | --- |
| `/dashboard` | Session and Admin check, Dashboard data context | `DashboardClient` | Admin-only |
| `/services` | Session check, Service/sparepart data | `ServicesClient` | Admin/User according to existing service rules |
| `/sls` | Session check, SLS/sparepart data | `SlsClient` | Admin/User according to existing SLS rules |
| `/purchases` | Session check, Purchase/sparepart data | `PurchasesClient` | Admin/User according to existing Purchase rules |
| `/expenses` | Session and Admin check, Expense data | `ExpensesClient` | Admin-only |
| `/spareparts` | Session check, sparepart data/filter | `SparePartsClient` | Admin/User projection rules |
| `/stock-opname` | Session check, Stock Opname data | `StockOpnameClient` | Admin/User lifecycle rules |
| `/stock-card` | Session and Admin check, movement data | Page-local table | Admin-only |
| `/reports` | Session and Admin check, report context | `ReportsClient` | Admin-only |
| `/admin/users` | Admin user management page | `UserManagementClient` | Admin-only |

### Special standalone page

- `/ganti-password` uses `ChangePasswordForm` and is part of the authentication transition flow.
- It should remain a focused standalone form without operational navigation until the password requirement is satisfied.

## 5. Recommended AppShell

The current repository does not contain `AppShell`, `Sidebar`, `Header`, or `NavigationGroup` components. The following is the recommended shared structure for the next implementation batch:

```text
AppShell
├── AppSidebar
│   ├── Brand block
│   ├── NavigationGroup: Operasional
│   ├── NavigationGroup: Persediaan
│   ├── NavigationGroup: Keuangan
│   └── NavigationGroup: Pengaturan
├── Mobile drawer and overlay
└── Main area
    ├── AppHeader
    └── Page content
```

Recommended component responsibilities:

- `AppShell`: authenticated page frame, sidebar visibility, main content sizing, and print exclusion.
- `AppSidebar`: logo, brand name, role-filtered links, active route state, and desktop/mobile presentation.
- `AppHeader`: page title, mobile menu trigger, optional breadcrumb/location, role/user information, and existing `LogoutButton`.
- `NavigationGroup`: consistent group heading and link rendering.
- `PageContainer`: optional content width/padding wrapper if repeated page spacing cannot be handled by `AppShell`.

These names are recommendations, not existing components. Do not create all of them automatically if a smaller structure is sufficient.

### App Router strategy

The root layout should not receive the sidebar because it also wraps Login and the password-change page. The safer first implementation is an explicit shared shell for authenticated operational pages while leaving `/` and `/ganti-password` standalone.

Moving all pages into a new route group is not required for the first shell batch. It would move route files and increase migration risk while providing no business benefit.

## 6. Sidebar and Navigation

### Admin menu proposal mapped to verified routes

#### Operasional

- Dashboard: `/dashboard`
- Service: `/services`
- SLS: `/sls`

#### Persediaan

- Daftar Sparepart: `/spareparts`
- Purchase: `/purchases`
- Stok Movement: `/stock-card`
- Stock Opname: `/stock-opname`

#### Keuangan

- Expense: `/expenses`
- Reports: `/reports`

#### Pengaturan

- Manajemen User: `/admin/users`

Beranda may be represented by the logo/brand link or an explicit navigation item at `/beranda`.

### User menu

The sidebar must be generated from the role information passed by the authenticated Server Component. The current page-level authorization remains authoritative.

The current route checks indicate that these Admin-only destinations must not be presented to USER:

- `/dashboard`
- `/expenses`
- `/stock-card`
- `/reports`
- `/admin/users`

USER-visible operational destinations must remain consistent with the existing server rules, including Service, SLS, Purchase, Sparepart, Stock Opname, and Beranda where applicable.

Hiding a link is not security. Every existing server-side page/API authorization check must remain unchanged.

### Active state

- Exact path matching is preferred for top-level pages.
- Prefix matching may be used for nested administrative paths such as `/admin/users`.
- Active navigation uses the primary red and a subtle light-red surface or border.
- The active state must not be represented by color alone; include weight, border, or an equivalent non-color cue.
- Route URLs must remain exactly as they are.

## 7. Header

Recommended header content:

- Mobile menu button.
- Current page title.
- Optional breadcrumb/location text where it provides operational context.
- Current role or username if it can be passed from the existing session without a new client session system.
- Existing `LogoutButton`.

The header must not:

- create a new authentication/session mechanism;
- duplicate logout API behavior;
- change redirect behavior;
- expose sensitive session data.

The current `LogoutButton` at `src/components/logout-button.tsx` is reusable. Its CSRF, loading, error, and redirect logic should not be rewritten.

## 8. Content Area

The shared content frame should provide:

- `#F5F5F5` page background;
- white cards/panels;
- `#D9D9D9` borders;
- consistent desktop/tablet/mobile padding;
- adequate width for operational tables;
- no unnecessary full-screen decoration.

Page-specific forms and tables remain owned by their current client components. Batch 1 layout work must not turn into a wholesale table/form redesign.

### Tables

- Keep headings visible and readable.
- Align financial values and quantities to the right.
- Keep identifiers and descriptive text to the left.
- Use responsive horizontal scrolling only for tables that cannot reflow safely.
- Do not introduce page-level horizontal overflow as a substitute for table overflow.
- Preserve current status, revision, source, and detail behavior.

### Forms

- Group related fields in cards or sections.
- Keep labels visible above/alongside controls.
- Preserve existing `datetime-local`, date, select, textarea, and validation behavior.
- Use red for primary submit actions and neutral borders for secondary actions.

## 9. Component Guidance

### Buttons

- Primary: red background, white text, strong focus ring.
- Secondary: white/neutral background, dark text, thin border.
- Destructive: retain semantically distinct red treatment where existing behavior requires it; do not conflate every red button with destructive actions.
- Disabled: reduce opacity without removing readable text.
- Do not remove confirmation dialogs from existing lifecycle actions.

### Cards

- White surface on neutral page background.
- Thin border and restrained shadow.
- Consistent radius and padding within the shared shell.
- Avoid decorative cards that add no operational meaning.

### Status badges

- Use text plus color/border.
- Preserve internal status values and API contracts.
- Do not turn status styling into a business-rule change.
- Status colors must remain distinguishable from the primary action red when required.

### Dialogs and panels

- Preserve existing browser confirmation dialogs and inline detail panels.
- New shell mobile drawer is a navigation UI only; it must not become a transaction modal.
- Keep focus and close behavior predictable.

### Pagination

- Preserve existing page, page size, total, and endpoint behavior.
- Pagination controls should remain visible and usable inside the content area.
- Do not add or remove pagination as part of shell work.

## 10. Responsive Behavior

### Desktop

- Persistent sidebar on the left.
- Main content fills remaining width.
- Header spans the main content area.
- Tables retain useful columns and use local horizontal scrolling when necessary.

### Tablet

- Sidebar may use a narrower presentation or controlled collapse.
- Main content padding reduces without compressing form controls below usable size.
- Navigation groups remain readable.

### Mobile

- Sidebar becomes a drawer with overlay.
- Header contains a clear menu trigger.
- Drawer closes after navigation or explicit close.
- Main content occupies full width with safe horizontal padding.
- Logo uses a bounded `object-contain` container.
- Long brand text may wrap; it must not force horizontal overflow.
- Tables may scroll within their own container.

Collapse state is UI-only and must not be saved to the database or session. A persistent local preference is a **Recommendation** for a later batch, not a Batch 1 requirement.

## 11. Accessibility

- Text/background contrast must be checked for all red, black, white, and neutral combinations.
- Do not rely on color alone for active routes, status, errors, or direction.
- Every input keeps an associated visible label.
- Logo images use meaningful `alt` text.
- Icon-only buttons require accessible labels.
- Keyboard focus must be visible on links, buttons, form controls, and mobile drawer controls.
- Mobile drawer must support keyboard close and not leave focus trapped invisibly.
- Interactive targets should be large enough for touch use.
- Error/status messages retain semantic roles such as `alert` or `status` where already present.

## 12. Print and Export

- Login and password-change pages do not use the operational shell.
- For Reports, sidebar, header controls, filters, and navigation must be excluded from print using `print:hidden` or an equivalent print rule.
- Report content remains printable.
- PDF, Excel, and CSV are server-side output paths and do not use the browser DOM shell.
- No shell UI should be added to export data.
- Existing report numbers, formulas, columns, filters, pagination, and export headers must remain unchanged unless a separate approved task says otherwise.

## 13. Implementation Boundaries

Layout redesign must not change:

- URL or routing structure.
- API contracts.
- Database/schema/migrations.
- Authentication or session handling.
- `ADMIN`/`USER` authorization.
- Redirects, including password-change and logout redirects.
- Financial formulas, HPP, stock, Average Cost, audit, idempotency, or transaction lifecycle.
- Historical data or report calculations.
- Existing print/export data.

No new dependency should be added. The current stack already provides:

- Next.js App Router;
- React client/server components;
- Tailwind CSS;
- `next/image` for the verified logo asset.

## 14. Regression Checklist

Before accepting any shell batch, verify:

- Login still succeeds and fails through the existing API.
- Existing session redirects remain unchanged.
- Logout still uses the existing CSRF-protected flow.
- Beranda remains accessible after login.
- Dashboard remains Admin-only.
- Admin sees all valid Admin menu groups.
- USER does not receive Admin-only menu links.
- Server-side authorization still rejects unauthorized direct URL/API access.
- Service, SLS, Purchase, Expense, Sparepart, Stock Opname, Stock Movement, Reports, and User Management open through their current URLs.
- Existing filters, forms, pagination, detail panels, and lifecycle buttons remain usable.
- Active sidebar state matches the current route.
- Mobile drawer opens and closes without navigation or horizontal overflow regressions.
- Report Print excludes application navigation.
- PDF, Excel, and CSV output remain unaffected.
- No schema, API, or business-rule diff is introduced.

## 15. Recommended Batch Breakdown

### Batch 1A: Shell foundation

- Add the smallest viable `AppShell`, sidebar, header, and navigation configuration.
- Do not migrate every page in the same change.
- Validate mobile drawer and role-filtered navigation first.

### Batch 1B: Authenticated page adoption

- Adopt the shell page by page:
  - Beranda;
  - Dashboard;
  - Service;
  - SLS;
  - Purchase;
  - Sparepart;
  - Stock Opname;
  - Stock Movement;
  - Expense;
  - Reports;
  - User Management.
- Remove duplicated page-level navigation only after shared shell behavior is verified.

### Batch 1C: Header and spacing normalization

- Normalize page titles, content padding, card placement, and redundant back links.
- Keep page-specific table/form behavior intact.

### Batch 1D: Responsive and accessibility polish

- Validate drawer, focus, contrast, logo sizing, mobile wrapping, and table overflow.

### Batch 1E: Regression verification

- Run typecheck, lint, existing tests, production build, and `git diff --check`.
- Perform manual route, role, print, and export checks.

This document does not authorize implementation of Batch 1A. It is the design-system and layout reference only.
