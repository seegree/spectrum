# JSX Design Principles

Design philosophy, hard-won gotchas, and process guidance for building
After Effects ScriptUI panels (.jsx), codified from the Archive Slideshow
panel redesign (v0.4 → v0.6.4). Written to be copied into any AE tooling
repo and followed from the first line of UI code. Companion deep-dive:
`scriptui-icon-tiles.md` (the icon-toggle recipe in full).

## 1. Design philosophy

**Small enough to live in the layout.** The best plugins are the ones
that stay docked. Budget the panel against a working AE layout on a small
screen — it should sit beside the Project panel without pushing anything
below the fold. Every row must argue for its height.

**Show, don't label.** Anything that describes a *visual outcome* (a
framing, a layout, a transition, a color treatment) should be drawn, not
written: a small diagram tile that toggles. Words go in the tooltip
(`helpTip`) where they cost no pixels. Text labels are for values (W, H,
FPS) and actions (Build).

**One selection model everywhere.** Selected tiles form the allowed
pool: one selected = forced everywhere; several = the automatic mix
chooses among them; all = full mix. Users learn it once and every
control obeys it. Give meaning to the empty state where it's natural
(no movement selected = still) instead of making it an error.

**Post-operations over build options.** The most valuable controls act
on the *result* (Cycle, Merge, Split) rather than adding up-front
configuration. Prefer a smaller build UI plus stronger refine tools over
a wall of options. Keep action buttons visible on every tab.
The test for where a value belongs: if it can only be chosen well by
seeing the result live — you'd scrub it and watch — it belongs on the
generated artifact (Effect Controls), not in the build panel. Port
offsets fail the "can you pick it blind?" test; stroke width passes.
(FlowDiagram: offsets left the panel entirely, saving a row, and the
Effect Controls workflow is the better one anyway.)

**Persist state, not commands.** A control that only feeds an action
button (a preset dropdown next to Apply) is a command input, not a
state readout — don't persist its last value across sessions. A
remembered command poses as "the current state" and will eventually
lie, because the real state (colors, sliders) persists on its own and
drifts. (FlowDiagram: the panel reopened showing a "Classic" preset
beside a Gradient of 0 — two memories, one implied lie.)

**Structure must earn its ink.** Category headings only where rows
aren't self-explanatory; a folder button, dimension fields, and two
checkboxes need no heading. Notes and disclaimers go in tooltips, not
panel text. Abbreviate labels when the tooltip carries the full name
(BG, Titles) — but never abbreviate an action.

**Hide settings that have one right answer.** A tuning value nobody
changes (the 110% enlargement ceiling) becomes a named constant with the
behavior documented in the README, not a field. The panel should only
ask questions the user actually answers differently per project.

**One accent, doing real work.** A single custom-painted accent button
(Build) marks the primary action; everything else stays native-dark.
Genuinely colored icons are reserved for controls *about* color.

**Defaults are the design.** Whatever the approved mock shows checked is
what a fresh panel opens with. A user who changes nothing should get the
designer's best output.

**Left-packed beats right-aligned.** The web habit of floating utility
controls to a row's right edge reads as untidy in a dockable panel: the
moment the dock gets wide, those controls drift away from their group.
Keep every row left-packed with fixed gaps; extra dock width is just
empty panel. (Animated Arrow: the color swatch "floated right" looked
fine at design width and orphaned at full width — hugging the easing
tiles was the keeper.)

## 2. Gotchas (all observed in AE 2026)

- **Toolbutton chrome fights custom tiles.** `iconbutton` with
  `style: "toolbutton"` draws its own outline (double border around a
  bordered PNG; on macOS a rounded ring even around a plain glyph),
  flashes the OS light-blue focus ring on click, and
  repaints unreliably when you swap `.image` after creation — tiles
  visually stop toggling. **Fix:** custom `onDraw` that calls
  `graphics.drawImage(this.value ? on : off)`, replacing all native
  painting. Own clicks repaint automatically (ScriptUI re-invokes
  onDraw per mouse/state transition).
- **Never trade tile quality for modal survival.** Modal blank-out is
  inherent to AE panels — native-painted controls blank behind a modal
  too (verified against Key Cloner), so "native paints survive modals"
  is not a reason to accept toolbutton chrome. The onDraw tile recipe
  is always the right choice for tiles; the blank-behind-a-dialog is a
  cost you pay either way, and it heals when the dialog closes.
- **Programmatic state changes don't repaint** a custom-drawn control
  (radio siblings, presets, all/none). Force it:
  `c.visible = false; c.visible = true;`.
- **The tallest tab taxes every tab.** A `tabbedpanel` sizes to its
  largest tab (good: no resize on switching; bad: one bloated tab makes
  the whole panel tall). Budget tabs to near-equal heights; merging one
  row on the tallest tab shrinks the entire panel.
- **ScriptUI has no colored button.** An accent-colored primary button
  needs custom `onDraw` (`rectPath`/`fillPath`/`drawString`, with
  `drawState.mouseOver` / `leftButtonPressed` shades). Wrap all drawing
  in try/catch — a failed paint must still leave a working button.
- **PNG icons embed as binary strings.** `ScriptUI.newImage()` accepts
  raw PNG bytes as a `\xNN`-escaped string — no sidecar files. Ship
  three fallbacks: binary string → temp-file image → labeled checkbox,
  so an image failure never costs a control.
- **Text styling is host-fragile.** `statictext` dim/small headings via
  `graphics.foregroundColor` + `ScriptUI.newFont` work in AE but wrap
  them in try/catch; the plain label is the acceptable fallback.
- **Never open a modal during panel startup.** AE blocks dialogs while
  panels restore at launch and reports a cryptic "line 0" error; alerts
  belong in button handlers only, and `onResize` must never throw.
- **`preferredSize` is a suggestion, not a lock.** The layout manager
  hands a row's spare width to children as it pleases, and a control
  with only `preferredSize` can silently stretch (a 40px swatch button
  became a ~200px bar). Any control that must not stretch needs
  `minimumSize` *and* `maximumSize` set to the same value as
  `preferredSize` — all three.
- **ES3 only.** No `Array.indexOf`, `map`, `filter`, JSON, `const`;
  write the loops. Also mind literal bytes: an editing slip that embeds
  a NUL in a string literal makes tools treat the source as binary.
- **Watch the widest row.** Vertical savings often trade horizontal:
  the longest row sets the panel's minimum dock width. Abbreviate its
  labels (tooltips keep the full words) or redistribute controls.
- **Copy, don't move, on install.** The repo file is the source of
  truth; installing into `Scripts/ScriptUI Panels` is always a copy.
- **`setTemporalEaseAtKey` ease arrays must match the property's
  dimensionality.** One `KeyframeEase` per value dimension — and Scale is
  3-dimensional in the API even on a 2D layer, so `[ease, ease]` throws
  "Value array does not have 3 elements" at creation time. Spatial values
  (Position) instead take a single ease. Size the array from
  `property.value.length` gated on `propertyValueType`, never hardcode it.
  (Annotation Studio v1: every callout creation failed on the card's
  Scale ease — the default path never worked.)
- **Never reorder shape-layer contents with `Property.moveTo`.** Moving
  a paint entry (e.g. a Gradient Fill) inside a shape group's contents
  throws AE's "internal verification failure … (mismatch with resultP)"
  at the moveTo call. Add properties in render order in the first place;
  if an existing stack must change order, capture values/expressions,
  `remove()` the entries, and re-add them in the desired order.

## 3. Process: mock first, then build

**Author the UI as a clickable HTML mock before writing ScriptUI.**
Iterating in a browser costs minutes; iterating in AE (restart, reload,
screenshot) costs hours. The mock is an HTML page styled to look like an
AE panel (dark #1d1d1d chrome, faux widgets), published where it can be
clicked through: tabs switch, tiles toggle, radios release. Judge
wasted space, hierarchy, and interaction *there*, then translate.

Rules that make mocks pay off:

- **Wireframe honesty.** Mock only what ScriptUI can do (native-ish
  widgets, tooltips, tabs, one custom-painted button). Annotate each
  proposed element with its ScriptUI feasibility so approval means
  buildable. Don't sell pixel styling the host can't render.
- **The mock's state is the spec.** Checked states become shipped
  defaults; geometry becomes icon geometry. "What you approved is what
  ships" — generate the real PNG icons from the same shapes as the
  mock's SVG tiles. Corollary: draw the mock in the fresh-install
  state, never a mid-workflow state — a mock drawn "after applying a
  preset" reads as shipped defaults and gets approved as such. Any
  state a user action produces belongs in an annotation, not in the
  drawn controls.
- **Icon honesty test.** Before approving an icon set, try to name each
  tile without its tooltip. Any icon you can't guess gets redrawn.
- **The mock hides resize behavior.** A mock approved at one width makes
  silent flexbox promises (stretch ratios, right-alignment) that ScriptUI
  expresses completely differently — both of Animated Arrow's wide-dock
  bugs were invisible in the mock. Decide and annotate, per row, what
  happens with extra width (which control stretches, which stay fixed),
  and screenshot-test the real panel at a narrow *and* a wide dock
  width, never just the design width.
- **Compare variants side by side** (current vs. proposals) with a
  critique of the current layout — decisions come easier when the cost
  of the status quo is visible. Expect to keep iterating in the mock:
  balance tab heights, collapse dropdowns to checkboxes, merge rows.
- **Verify generated art before shipping:** render a contact sheet of
  all icons/states and *look at it*.
- **Automate the asset pipeline.** Icons come from a stdlib-only
  generator script committed to the repo, spliced into the .jsx between
  marker comments (`/*__ICON_DATA_BEGIN__*/` … `END`), so a size or
  palette change is a regenerate, not a redraw.
- **MVP discipline.** Defer features that complicate the core for rare
  cases (N-up layouts) — a special-purpose fork later beats a bloated
  panel now. Syntax-check every round (JavaScriptCore works headless),
  commit each completed round, and test live in AE at every UI
  milestone: screenshots with annotations are the fastest feedback
  loop between user and builder.
