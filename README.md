# Spectrum for After Effects

Spectrum is a dockable ScriptUI panel for Adobe After Effects. It distributes a
multi-stop color ramp across the selected layers — each layer gets one solid
color, and together they read as a gradient.

It exists because After Effects has no palette object: to make 25 circles fade
from navy to aqua you otherwise pick 25 colors by hand.

## Install

1. Quit After Effects.
2. Copy `Spectrum.jsx` into the After Effects `Scripts/ScriptUI Panels` folder.
3. Restart After Effects.
4. Open **Window > Spectrum**.

Typical macOS location:

```text
/Applications/Adobe After Effects 2026/Scripts/ScriptUI Panels/
```

Typical Windows location:

```text
C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\Scripts\ScriptUI Panels\
```

The repo file is the source of truth — installing is always a copy, never a move.

## Use

1. Select the layers to color.
2. Set the ramp: click a swatch to choose a color, `+` to add a stop, `−` to
   remove one.
3. Choose an order — `≡` for timeline stacking order, or a direction arrow.
4. Choose what to write: Fill, Stroke, or Fill effect.
5. Click **Apply**.

One undo reverts the whole run.

### The ramp

Between 2 and 8 stops, always evenly spaced. The strip below the swatches shows
exactly what will be applied: it draws one step per selected layer, so with 25
layers selected you are looking at the 25 colors that will land. With nothing
selected it shows 9 sample steps.

- **`+`** adds a stop sampled from the current ramp, so the gradient does not
  jump. Going from two stops to three is exact.
- **`−`** removes the last *interior* stop, keeping both end colors — so `+`
  then `−` returns exactly where you started.
- **Option/Alt-click a swatch** removes that specific stop.
- **`⇄`** reverses the ramp.
- **The eyedropper** samples the existing fill colors of the first and last
  selected layers into the end stops. The report names the layers it read from.

### Order

`≡` uses timeline stacking order, top layer first.

The eight arrows ramp along a direction — the arrow points the way the ramp
travels, first stop at the tail. Clicking one writes its angle into the field
beside it, so `→` shows `0` and `↑` shows `90`. The tiles are shortcuts, not a
cage: type any angle and the ramp follows it with no tile lit.

Spatial order uses each layer's position **in comp space**, not its raw
position. Those differ the moment a layer is parented: `layer.position` is
measured relative to its parent, so ordering by it sorts a parented grid
scrambled. Expressions solve this with `toWorld()`, which scripting does not
provide, so Spectrum composes the parent chain itself — exact for translation,
scale and Z rotation at any depth of parenting. A parent rotated out of plane
in 3D sorts approximately.

Layers that land on the same point fall back to stacking order, which keeps the
result stable and repeatable.

### Targets

- **Fill** and **Stroke** set the color of every Fill or Stroke in a shape
  layer's contents, including inside nested groups.
- **Fill effect** adds or updates a `Spectrum Fill` effect. It works on any
  layer type and floods the whole alpha, so it erases the fill/stroke
  distinction. Re-applying reuses the existing effect rather than stacking a
  new one each run.

### What gets skipped, and why

Apply always reports what it did and what it did not, because a silent no-op on
3 of 25 layers that looks like success is the worst outcome:

| Skipped | Reason |
| --- | --- |
| Gradient fills and strokes | Gradient stops cannot be set through scripting at all. |
| Expression-driven colors | A value written underneath an expression is ignored. |
| Animated colors | A keyframed property cannot take a plain value — see Settings. |
| Layers with no matching target | A null, or a shape layer with no Fill when only Fill is checked. |

There is deliberately no "locked layers" case: locking a layer in After Effects
makes it unselectable, so a panel driven by the selection can never meet one.

## Settings

The gear button opens a dialog for the two choices you set once and forget.

**Interpolation space** — OKLCH (default), HSL, or RGB.

OKLCH keeps steps perceptually even and avoids the gray middle. Interpolating
blue to yellow in RGB puts `#808080` at the midpoint — literally zero chroma —
where OKLCH gives `#01BAAE`. Change this only to match an existing look.

**Animated colors** — skip and report (default), or set a keyframe at the
playhead. Skipping leaves existing animation untouched; keyframing writes the
ramp color at the current time with `setValueAtTime`.

## Notes

**Near-complementary pairs.** Hue interpolation takes the shortest way around
the color wheel, so when two colors sit nearly opposite each other, which way is
shorter is knife-edge. `#1B2A6B` → `#F2C14E` is 176.4° of arc; a few hex values
of change takes it past 180° and the whole ramp reroutes the other way around
the wheel, through teal instead of magenta, from an edit you cannot see. If a
ramp travels a route you did not want, **add a middle stop** — a third stop pins
the route explicitly. The shipped default is navy → aqua at ~71° of arc,
comfortably clear of the edge.

**The panel cannot see your selection change.** After Effects gives ScriptUI
panels no callback when the timeline selection changes, so Spectrum re-reads it
whenever the pointer enters the panel. The layer count on the Apply button is
therefore a hint that can lag by a moment, not a live readout — it catches up as
soon as you move the mouse over the panel.

For that reason **Apply is never greyed out**. It re-reads the live selection at
the moment you click and tells you if there is nothing there. An earlier build
disabled it when the cached count was zero, which deadlocked the panel: a
disabled button cannot be clicked, so clicking it could not trigger the refresh
that would re-enable it, and no amount of selecting layers would bring it back.
`test/check-syntax.js` enforces this as an invariant.

**The preview strip blanks while the color picker is open.** It is painted by
script, and After Effects blanks script-painted controls behind a modal dialog.
It repaints when the picker closes. The swatches use a native background fill
specifically so they keep painting throughout.

**Settings persist across sessions** under the `Spectrum` section: the stop
list, order mode, angle, target checkboxes, and both dialog choices. A
malformed stored ramp falls back to the default two stops rather than failing to
open.

## Development

Run every headless check:

```bash
sh test/run-all-jsc.sh
```

That is 88 assertions covering syntax, the ES3 guard, the ramp math, and the
ordering/writing engine. macOS ships the `jsc` runtime it uses, so no install is
needed. With Node available, `node test/check-syntax.js`, `node test/run-tests.js`
and `node test/run-engine.js` do the same.

`Spectrum.jsx` is deliberately one file — a dockable panel installs by copying a
single file — so the tests reach inside it via marker comments:

| Block | Sliced by | Covers |
| --- | --- | --- |
| `/*__SPECTRUM_MATH_BEGIN__*/` | `test/tests.js` | OKLab/HSL/RGB interpolation, gamut mapping, stop lists, projection |
| `/*__SPECTRUM_ENGINE_BEGIN__*/` | `test/engine-tests.js` | Layer ordering, the shape-contents walk, skip accounting, the report |

The math block must not touch After Effects globals at all. The engine block may
read AE objects — the harness injects stub layers and a stub `app` — but must
not reach for the project or the selection, which is why `applyRamp` sits
outside it.

What the headless tests cannot cover is the ScriptUI layer itself: layout,
custom `onDraw` painting, selection tracking, and the modal color picker all
need a live After Effects session. Where a bug in that layer has actually
shipped, `check-syntax.js` carries an invariant check for it instead — see the
`INVARIANTS` list.

`tools/diagnose.jsx` is a read-only script for the opposite problem: when Apply
reports success but the comp does not look right, run it on the selection and it
reports how many distinct fill colors and distinct comp-space anchors the
layers actually have.

`docs/mock.html` is the approved design, with the reasoning behind each layout
decision recorded beside it. `docs/jsx-design-principles.md` holds the
panel-building conventions these tools share; the section references in the
source (§1, §2, §3) point there.
