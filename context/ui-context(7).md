# SwapCircle UI Context

Companion to `ARCHITECTURE.md`, which defines product behavior and data access. Place this file at `context/ui-context.md`; paths below are relative to the repository root.

## Visual References

Use only the two approved homepage references for visual direction:

- Light: `context/images/homepage/swapcircle-home-light.png`
- Dark: `context/images/homepage/swapcircle-home-dark.png`

There is no separately approved dashboard, mobile, or open-profile-drawer image. Extend the same visual language to those views using the rules below. Earlier neon, glass, gold, and editorial concepts are not references.

**Visual language:** approachable, photography-led, rounded, and orderly. Light mode uses pale backgrounds, white cards, blue primary actions, and green community accents. Dark mode is matte near-black/charcoal with restrained forest-green actions, subdued text accents, thin borders, and no luminous effects.

The images establish appearance, not feature scope or valid interaction states. Exact tokens, font stacks, dimensions, and responsive behavior below are implementation specifications, not measurements extracted from the images. Reference inconsistencies and unspecified features are called out below rather than treated as requirements.

## Theme

Support **Light**, **Dark**, and **System**. First visit follows the system preference; persist an explicit choice locally and apply it before the first paint. Theme changes must not reset forms or open overlays. Profile and trade overlays remain closed until requested.

Define colors in `apps/web/src/styles/globals.css`, with light values in `:root` and dark overrides under `.dark` on `<html>`. Map variables to semantic Tailwind tokens. Never hardcode colors or use raw palette utilities such as `slate-*`, `zinc-*`, or `green-*` in components.

Use `@theme inline` in Tailwind v4; an existing v3 project must expose the same semantic names through `tailwind.config.ts`. Keep a single token source and do not mix configuration approaches.

Dark mode must not use neon, shine, glow, glassmorphism, bright panel fills, decorative gradients, or background patterns. Off-white text and visible focus indicators remain necessary; do not make content unreadably dim to achieve darkness.

### Dark Mode Tokens

| Role | CSS Variable | HEX / Value |
| --- | --- | --- |
| Page background | `--bg-base` | `#0F1315` |
| Soft page background, solid | `--bg-base-soft` | `#0F1315` |
| Surface | `--bg-surface` | `#171D20` |
| Elevated surface | `--bg-elevated` | `#20282B` |
| Subtle surface | `--bg-subtle` | `#1A2225` |
| Inset surface | `--bg-inset` | `#101619` |
| Overlay scrim | `--bg-overlay` | `rgb(0 0 0 / 0.72)` |
| Background pattern, disabled | `--bg-pattern` | `transparent` |
| Default border | `--border-default` | `#2C363A` |
| Subtle border | `--border-subtle` | `#232C30` |
| Strong / control border | `--border-strong` | `#718187` |
| Primary text | `--text-primary` | `#ECEFEF` |
| Secondary text | `--text-secondary` | `#BDC6CA` |
| Muted text | `--text-muted` | `#9BA8AE` |
| Faint / disabled text only | `--text-faint` | `#68777D` |
| Brand button fill | `--accent-primary` | `#335E4C` |
| Brand hover | `--accent-primary-hover` | `#3D6B56` |
| Brand active | `--accent-primary-active` | `#294E3E` |
| Readable brand text | `--accent-primary-text` | `#91B5A2` |
| Brand soft background | `--accent-primary-soft` | `#1E2F28` |
| Brand dim background | `--accent-primary-dim` | `#18231F` |
| Brand glow, disabled | `--accent-primary-glow` | `transparent` |
| Secondary / community action fill | `--accent-secondary` | `#315846` |
| Text on filled actions | `--text-on-brand` | `#F1F5F2` |
| Focus ring | `--focus-ring` | `#97B9AA` |
| Destructive action fill | `--action-danger` | `#763A3A` |
| Destructive hover | `--action-danger-hover` | `#854343` |
| Success text / icon | `--state-success` | `#93B19C` |
| Warning text / icon | `--state-warning` | `#C3AC80` |
| Error text / icon | `--state-error` | `#D0A4A4` |
| Info text / icon | `--state-info` | `#9BABB7` |
| Chart primary | `--chart-primary` | `#91B5A2` |
| Chart secondary | `--chart-secondary` | `#9BABB7` |
| Chart tertiary | `--chart-tertiary` | `#C3AC80` |
| Card shadow | `--shadow-card` | `none` |
| Overlay shadow | `--shadow-soft` | `0 12px 36px rgb(0 0 0 / 0.32)` |
| Brand glow shadow, disabled | `--shadow-glow` | `none` |
| Primary gradient, disabled | `--gradient-primary` | `none` |
| Hero/background gradient, disabled | `--gradient-hero` | `none` |

### Light Mode Tokens

| Role | CSS Variable | HEX / Value |
| --- | --- | --- |
| Page background | `--bg-base` | `#F2F7FA` |
| Soft page background, solid | `--bg-base-soft` | `#F2F7FA` |
| Surface | `--bg-surface` | `#FFFFFF` |
| Elevated surface | `--bg-elevated` | `#FFFFFF` |
| Subtle surface | `--bg-subtle` | `#E9F0F5` |
| Inset surface | `--bg-inset` | `#EDF3F8` |
| Overlay scrim | `--bg-overlay` | `rgb(15 23 42 / 0.40)` |
| Background pattern, disabled | `--bg-pattern` | `transparent` |
| Default border | `--border-default` | `#D6E1EA` |
| Subtle border | `--border-subtle` | `#E5EDF3` |
| Strong / control border | `--border-strong` | `#7B8996` |
| Primary text | `--text-primary` | `#15223A` |
| Secondary text | `--text-secondary` | `#4D6075` |
| Muted text | `--text-muted` | `#53687A` |
| Faint / disabled text only | `--text-faint` | `#82919F` |
| Brand button fill | `--accent-primary` | `#1457D4` |
| Brand hover | `--accent-primary-hover` | `#1049B6` |
| Brand active | `--accent-primary-active` | `#0C3D98` |
| Readable brand text | `--accent-primary-text` | `#1457D4` |
| Brand soft background | `--accent-primary-soft` | `#E8F0FE` |
| Brand dim background | `--accent-primary-dim` | `#F1F5FE` |
| Brand glow, disabled | `--accent-primary-glow` | `transparent` |
| Secondary / community action fill | `--accent-secondary` | `#177047` |
| Text on filled actions | `--text-on-brand` | `#F1F5F2` |
| Focus ring | `--focus-ring` | `#245DCE` |
| Destructive action fill | `--action-danger` | `#B03333` |
| Destructive hover | `--action-danger-hover` | `#982D2D` |
| Success text / icon | `--state-success` | `#246947` |
| Warning text / icon | `--state-warning` | `#80591D` |
| Error text / icon | `--state-error` | `#B64141` |
| Info text / icon | `--state-info` | `#235E95` |
| Chart primary | `--chart-primary` | `#1457D4` |
| Chart secondary | `--chart-secondary` | `#177047` |
| Chart tertiary | `--chart-tertiary` | `#80591D` |
| Card shadow | `--shadow-card` | `0 2px 8px rgb(15 23 42 / 0.04)` |
| Overlay shadow | `--shadow-soft` | `0 12px 32px rgb(15 23 42 / 0.14)` |
| Brand glow shadow, disabled | `--shadow-glow` | `none` |
| Primary gradient, disabled | `--gradient-primary` | `none` |
| Hero/background gradient, disabled | `--gradient-hero` | `none` |

## Token Usage Rules

- Surface utilities: `bg-base`, `bg-surface`, `bg-elevated`, `bg-subtle`, `bg-inset`, and `bg-overlay` map to their `--bg-*` variables.
- Copy utilities: `text-fg-primary`, `text-fg-secondary`, `text-fg-muted`, and `text-fg-faint` map to `--text-*`. The `fg-` namespace avoids collision with shadcn's component-color names `primary` and `secondary`; border utilities similarly use `line-` so they do not collide with surface colors.
- Pair `bg-brand` with `text-on-brand`. Use `text-brand-ink` for links and hero emphasis, mapped to `--accent-primary-text`; do not use the dark button-fill color as text. Map hover/active fills separately.
- Use `bg-brand-soft` for selected surfaces and interest chips. Secondary/community actions use `bg-community` mapped to `--accent-secondary`, with `text-on-brand`; hover may use the same theme's brand-hover fill.
- Use `border-line-default` for cards, `border-line-subtle` for dividers, and `border-line-strong` for input/radio/checkbox boundaries that communicate interactivity. Use `ring-focus` with a surface-colored offset.
- Status text/icons use `text-state-*`; filled destructive buttons use `bg-danger` and `text-on-brand`, not the status-text color as a fill. Charts use only `chart-*` tokens.
- `shadow-card` is flat in dark mode; reserve `shadow-soft` for overlays. Retain pattern/glow/gradient variables only as disabled template slots; do not render decorative effects from them.

For Tailwind v4, aliases follow this pattern; map the remaining semantic names the same way:

```css
@theme inline {
  --color-base: var(--bg-base);
  --color-surface: var(--bg-surface);
  --color-subtle: var(--bg-subtle);
  --color-line-default: var(--border-default);
  --color-line-subtle: var(--border-subtle);
  --color-line-strong: var(--border-strong);
  --color-fg-primary: var(--text-primary);
  --color-brand: var(--accent-primary);
  --color-brand-ink: var(--accent-primary-text);
  --color-on-brand: var(--text-on-brand);
  --color-community: var(--accent-secondary);
  --color-focus: var(--focus-ring);
  --color-danger: var(--action-danger);
}
```

Map shadcn aliases to the same source: `--background`/`--foreground` to base/primary text, card to surface, popover to elevated, `--primary`/`--primary-foreground` to brand/on-brand, and secondary/muted/selection surfaces to subtle with readable text. Map `--border` to default, `--input` to strong, `--ring` to focus, and destructive actions to danger/on-brand. Never maintain a second palette in foundation components. Register same-named shadow/font tokens directly with their values; never create circular aliases such as `--shadow-card: var(--shadow-card)`.

## Typography

| Role | Font | CSS Variable |
| --- | --- | --- |
| UI text | `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | `--font-ui` |
| Code / mono | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | `--font-mono` |

Use system sans with antialiasing; no runtime font service is required. Mono is reserved for technical IDs and code, not navigation or marketing copy.

Body: 16px/1.5; controls: 14–16px; metadata: 12–14px, never essential copy below 12px. Section headings: 20–24px/600; hero: 32–48px/700 with a compact line height. Prefer 400/500/600/700 weights and tabular numerals for counts. Handwriting belongs only to optional decorative artwork, never controls or required instructions.

## Border Radius

Keep consistent rounding without oversized pill-shaped panels. Configure radius tokens to match these values.

| Context | Class / Value |
| --- | --- |
| Inline controls and inputs | `rounded-md` / 6px |
| Buttons and compact cards | `rounded-lg` / 8px |
| Cards and panels | `rounded-xl` / 12px |
| Hero shells | `rounded-2xl` / 16px |
| Dialog | `rounded-2xl` / 16px |
| Avatars and interest pills | `rounded-full` |
| Icon wells | `rounded-lg` / 8px |

A right-edge drawer is flush with the viewport edge, not a detached floating card.

## Background Pattern

**No repeated background pattern in either theme.** Use a static `bg-base` and ordinary surface layers. Do not add dot grids, noise, parallax, reactive lighting, or backdrop blur. Scrims dim the page without turning overlays into glass.

## Component Library

Foundation: **shadcn/ui + Tailwind CSS**, within the React/TypeScript application.

- Reusable primitives: `apps/web/src/components/ui/`; shared shell: `apps/web/src/components/layout/`; domain components: `apps/web/src/features/`.
- Compose primitives into `ListingCard`, `InterestChip`, `TradeProposalDialog`, `ProfileDrawer`, `ConversationList`, and `MeetupCard`. Do not introduce a parallel component framework.
- Prefer the foundation's Dialog, Sheet, RadioGroup, Checkbox, Select, and form primitives. Keep their keyboard/focus behavior; token wiring and required accessibility fixes are allowed, unrelated structural rewrites are not.
- React Hook Form + shared Zod contracts handle forms. TanStack Query owns server data; React state owns overlay state; URL parameters own catalog filters. Clear private caches and subscriptions on logout/account change. Do not duplicate auth sessions in UI stores.

## Layout Patterns

### Landing Page / Public Page

- Header: logo, public navigation, search, and sign-in. Never render another member's messages or private account controls for signed-out visitors. Launch sign-in uses Google through Supabase Auth; do not add unsupported password flows.
- Hero: copy on the left, warm community/café photography on the right. Stack on small screens. Use live text, not text baked into a screenshot.
- Exact headline: **“Less stuff. More connection.”** Emphasize the second sentence with `text-brand-ink`.
- Exact description: **“SwapCircle helps you give, get and meet — for a more meaningful, less wasteful world.”**
- Primary actions: **List an item** and **Browse items**. Listing creation requests sign-in when necessary.
- Feature cards: genuine available listings with a consistent photo ratio, title, condition, owner, and approximate location. Preserve true item colors; do not darken photos merely to match the theme.
- Secondary content: use actual aggregate counts or explicitly labeled demo content. Never publish the mockup's invented membership, swap, coffee, or impact numbers as real statistics.
- Footer: restrained navigation to implemented help, safety, privacy, and terms pages. Background remains plain.

### Primary App Screen / Dashboard

- Shell: 64px sticky header; centered fluid content; main column plus approximately 340px right rail at widths of 1280px and above. Below that, stack secondary modules after the main content.
- Navigation: Home, Browse, My Swaps, Community; compact account avatar/name and notifications at right. On small screens collapse navigation/search without losing access. Search results must not expose private conversations or meeting details.
- Main: hero, featured listings, then member discovery. Listing grids adapt from four columns on wide layouts to two or one; never shrink text to preserve the screenshot's density.
- Right rail: shared-interest discovery and conversation previews. **These are not the account profile drawer.** Opening or closing the drawer does not remove the rail.
- Cards: consistent photo ratios, aligned titles, reserved image dimensions, and discreet borders. Lists use pagination; tables are reserved for genuinely tabular moderation data.
- The pictured trade dialog illustrates an open interaction state. It is **not open on page load**, not a permanent third column, and must not overlap content without proper modal behavior.

**Unspecified mockup features:** Events, favorite hearts, and Connect controls appear in the images but their workflows are not defined in `ARCHITECTURE.md`. Keep them as design-preview elements only until their behavior is specified; omit dead controls and fabricated event cards from production. Direct messaging is already defined and should remain available through a clearly labeled Message action.

### Secondary Pages / Feature Pages

Reuse the shell, tokens, spacing, and card treatment. Keep behavior inside feature components; backend authorization determines available data, not frontend hiding.

- Browse/detail: shareable filters, condition and photo details, owner profile, Message, and Propose a trade.
- Profile: biography, approximate location, selectable interest tags, and listings. Public member pages are distinct from the private account drawer.
- Trades: scalable participant/item lists, clear give/receive summaries, version-specific acceptance, meeting details, and an event history. Never hardcode two or three user slots.
- Messages: conversation list plus thread on desktop; list/thread navigation on mobile. Direct and group conversations are distinct.
- Safety: reachable block/report actions, readable unavailable/restricted states, and no exact public meeting addresses.

## Spacing and Density

- Page max width: 1600px; horizontal padding 16px mobile, 24px tablet, 32px desktop.
- Card padding: 16–24px; grid gaps: 16–24px; section separation: 24–32px.
- Base spacing unit: 4px. Prefer whitespace to extra borders and decoration.
- Controls: at least 44px high for primary touch interactions; full-width dialog actions on narrow screens.
- Dialog: approximately 480px wide with viewport-safe margins and internal scrolling. Group proposals may widen to 640px. Drawer: 400px wide, capped at viewport width.
- No page-level horizontal scrolling. Truncate previews only when the full content is reachable; never truncate essential consent, errors, or trade terms.

## Buttons and Interactions

- Primary: flat semantic fill, readable on-brand text, 8px radius, no glow. One dominant action per form.
- Secondary: surface/transparent fill, visible border, regular text. Destructive actions require an explicit label and confirmation where appropriate.
- Active navigation: underline plus readable brand text; do not rely on color alone.
- Focus: 2px `ring-focus` with a 2px surface offset. Never remove keyboard focus styling.
- Transitions: 120–180ms for color/opacity; up to 220ms for drawer movement. No bounce, parallax, pulsing controls, or luminous shimmer. Honor reduced-motion preferences.

### Profile Drawer

Closed by default, including after reload. Clicking the header account control opens a right-side Sheet; it does not permanently resize the page or open a dropdown instead. Include profile summary, profile/settings navigation, theme selection, and sign-out.

Provide a visible close button, Escape/backdrop dismissal, focus trapping, an accessible title, background scroll lock, and focus restoration to the trigger. On small screens the drawer may fill the viewport. Do not persist its open state or open it automatically after sign-in.

### Trades and Coffee

- Trades support **two or more people** and multiple items. Display exactly who gives and receives each item; do not require a three-way cycle, equal values, a wishlist, or closed-community membership.
- **Meet to swap** is always available for a permitted trade. Default to it.
- Show **Swap + coffee** only when the backend confirms at least **two distinct shared interest IDs** for the inviter/invitee pair. Show the matching tags, not a compatibility percentage. Ineligible users can still trade and message.
- **Coffee on me** is an optional, initially unchecked add-on shown only when an eligible coffee invitation is selected. It records an offer to pay in person, not an online payment or a separate trade type. **Do not copy the mockup's checked coffee box while Meet to swap is selected.**
- Coffee consent is independent. The recipient can accept the swap and decline coffee without penalty. For groups, evaluate and accept invitations per pair; not everyone must join. Recheck eligibility on send/accept; later interest edits do not undo an accepted plan.
- Keep participant invitation acceptance separate from acceptance of trade terms. Changing participants, items, or material condition creates new terms and invalidates earlier trade acceptances; changing meeting time/place requires renewed meeting confirmations.
- Reflect authoritative states: `proposed`, `confirmed`, `completed`, `declined`, `expired`, `cancelled`, `disputed`. Never optimistically confirm a trade or claim items are reserved before the API confirms it. On conflicts, refresh terms/availability and explain what changed.
- Confirmed does not mean handed over. Completion requires everyone's receipt acknowledgement; reported partial handovers/problems need the dispute flow, not a casual cancel-and-release action. Coffee cancellation remains separate.

### Messaging, Loading, and Recovery

Direct messages can precede a trade. Three-or-more-person trades use a separate group thread; invited members gain access only after accepting membership. Never reveal earlier direct messages to the group or describe messaging as end-to-end encrypted. Blocking prevents new direct contact; existing group visibility follows `ARCHITECTURE.md`.

Show sending/sent/failed message states and a retry action that preserves the same deduplication ID. Backfill history after reconnecting; do not treat realtime delivery as the permanent record. Do not display online/typing indicators until presence is implemented.

Provide loading, empty, error, permission-denied, unavailable, and retry states for each data view. Use quiet skeletons without shimmer. Show an honest API-wakeup/reconnecting notice for slow requests; preserve drafts on recoverable failures and never replace errors with fake content. Use inline errors for actionable problems, polite announcements for progress, and sanitized request IDs for support. Hide private previews on logout.

## Icons

Icon library: **Lucide React**. Use a consistent outline stroke; photography and the logo are separate visual assets.

| Context | Size |
| --- | --- |
| Inline text icons | 16px |
| Buttons and navigation | 18–20px |
| Stat / summary cards | 24px |
| Feature / empty-state icons | 32px |

Use icons such as exchange arrows, Coffee, MessageCircle, MapPin, and Plus as appropriate. Do not mix emoji, 3D icons, and unrelated filled icon sets in controls. Hide decorative icons from assistive technology; label icon-only actions and provide full-sized hit targets.

## Charts and Data Visualization

Charts are **not a launch requirement**. The tokens are reserved for a specified future use, not permission to add a dashboard.

- Primary: `--chart-primary`; secondary: `--chart-secondary`; tertiary: `--chart-tertiary`.
- Use labels, shapes, or line patterns for additional series, not random saturated colors.
- Grid/axes use subtle borders; labels use readable secondary/muted text. Provide text equivalents for meaningful data.
- Never infer environmental impact, compatibility scores, or community statistics from decorative mockup numbers.

## Accessibility

- Project contrast targets: at least 4.5:1 for ordinary text and 3:1 for large text and meaningful control indicators. Check actual token combinations in both themes; `text-fg-faint` is only for disabled/nonessential decoration.
- Every action needs visible keyboard focus and a usable hover state. Use semantic buttons/links, proper headings, and no nested interactive targets inside listing links.
- Forms need persistent labels, associated helper/error text, and accessible radio/checkbox groups. Do not use placeholders as the only label.
- Status and interest eligibility need readable text, not color alone. Announce async changes without repeatedly interrupting conversation reading.
- Give item photos useful alternative text; decorative imagery has empty alt text. Never embed required copy solely in a photograph.
- Dialogs/drawers must trap and restore focus, mark the background inert, and remain usable with keyboard and screen reader. Avoid simultaneous stacked profile/trade overlays; protect unsaved work before switching.
- Respect reduced motion, text zoom, and smaller viewports. Display meeting date/time with its explicit time zone; keep exact locations visible only to authorized participants.

Before shipping, run automated accessibility checks and manual keyboard checks in both themes. Exercise 360px, 768px, 1280px, and 1600px layouts plus 200% zoom; verify closed/open drawers, eligible/ineligible coffee, group trades, stale proposals, errors, and empty states. Compare composition with the references without reproducing their incorrect or unspecified behaviors.
