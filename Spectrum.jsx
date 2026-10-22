/*
 * Spectrum — color ramp distribution for After Effects
 * v0.1.0
 *
 * Distributes a multi-stop color ramp across the selected layers: each layer
 * gets one solid color, and together they read as a gradient.
 *
 * Install: copy this file into the After Effects
 *   Scripts/ScriptUI Panels
 * folder, restart AE, then open Window > Spectrum.
 *
 * Design notes and hard-won gotchas: docs/jsx-design-principles.md
 * Approved layout and its rationale: docs/mock.html
 *
 * ES3 only — no Array.indexOf/map/filter, no JSON, no const/let. Write the
 * loops.
 */

(function (thisObj) {

    var VERSION = "0.1.0";
    var SETTINGS_SECTION = "Spectrum";
    var EFFECT_NAME = "Spectrum Fill";

    var MAX_STOPS = 8;
    var MIN_STOPS = 2;

    /* Steps drawn in the preview strip when nothing is selected. A tuning
     * value with one right answer, so it is a constant and not a field (§1). */
    var NO_SELECTION_STEPS = 9;

    /* Fresh-install ramp: navy to aqua, ~71 degrees of hue arc. Deliberately
     * clear of the 180-degree point where shortest-arc hue routing flips
     * direction — see "Near-complementary pairs" in docs/mock.html. */
    var DEFAULT_STOP_HEXES = ["#1B2A6B", "#4FC3C7"];

    /* Palette, matching the mock. */
    var COL_TILE_BG = [0.176, 0.176, 0.176];
    var COL_TILE_BG_ON = [0.141, 0.251, 0.353];
    var COL_TILE_EDGE = [0.063, 0.063, 0.063];
    var COL_TILE_EDGE_ON = [0.502, 0.769, 0.941];
    var COL_GLYPH = [0.604, 0.604, 0.604];
    var COL_GLYPH_ON = [0.863, 0.937, 1.000];
    var COL_GLYPH_OFF = [0.353, 0.353, 0.353];
    var COL_ACCENT_TOP = [0.486, 0.741, 0.910];
    var COL_ACCENT_BOT = [0.353, 0.639, 0.831];
    var COL_ACCENT_EDGE = [0.302, 0.565, 0.753];
    var COL_ACCENT_TEXT = [0.063, 0.133, 0.180];
    var COL_DISABLED_BG = [0.176, 0.176, 0.176];
    var COL_DISABLED_TEXT = [0.490, 0.490, 0.490];

    var TILE = 20;
    var SWATCH = 20;

    /* Eight direction shortcuts. The arrow points the way the ramp travels:
     * first stop at the tail, last stop at the head. */
    var DIRECTIONS = [0, 45, 90, 135, 180, 225, 270, 315];
    var DIRECTION_NAMES = {
        "0": "left to right",
        "45": "up and to the right",
        "90": "bottom to top",
        "135": "up and to the left",
        "180": "right to left",
        "225": "down and to the left",
        "270": "top to bottom",
        "315": "down and to the right"
    };

    /*__SPECTRUM_MATH_BEGIN__*/
    /* ----------------------------------------------------------------------
     * Pure ramp math. No AE globals below this line and none above the END
     * marker — test/run-tests-jsc.js slices this block out of the file and
     * evaluates it standalone, so it must stay self-contained.
     * ------------------------------------------------------------------- */

    var CHROMA_EPS = 1e-4;

    function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
    function cbrt(x) { return x < 0 ? -Math.pow(-x, 1 / 3) : Math.pow(x, 1 / 3); }

    function srgbToLinear(c) {
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    function linearToSrgb(c) {
        return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    }

    function rgbToOklab(rgb) {
        var r = srgbToLinear(rgb[0]);
        var g = srgbToLinear(rgb[1]);
        var b = srgbToLinear(rgb[2]);
        var l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
        var m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
        var s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
        var l_ = cbrt(l), m_ = cbrt(m), s_ = cbrt(s);
        return [
            0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
            1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
            0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
        ];
    }

    function oklabToRgbRaw(lab) {
        var l_ = lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2];
        var m_ = lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2];
        var s_ = lab[0] - 0.0894841775 * lab[1] - 1.2914855480 * lab[2];
        var l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
        return [
            linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
            linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
            linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
        ];
    }

    function oklabToOklch(lab) {
        var c = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
        var h = Math.atan2(lab[2], lab[1]) * 180 / Math.PI;
        if (h < 0) { h += 360; }
        return [lab[0], c, h];
    }
    function oklchToOklab(lch) {
        var rad = lch[2] * Math.PI / 180;
        return [lch[0], lch[1] * Math.cos(rad), lch[1] * Math.sin(rad)];
    }

    function inGamut(rgb) {
        var i;
        for (i = 0; i < 3; i++) {
            if (rgb[i] < -0.0001 || rgb[i] > 1.0001) { return false; }
        }
        return true;
    }

    /* Out-of-gamut OKLCH is resolved by reducing chroma, never by clamping
     * channels: clamping visibly shifts hue. Binary search, 8 passes. */
    function oklchToRgb(lch) {
        var rgb = oklabToRgbRaw(oklchToOklab(lch));
        var lo, hi, mid, i;
        if (!inGamut(rgb)) {
            lo = 0;
            hi = lch[1];
            for (i = 0; i < 8; i++) {
                mid = (lo + hi) / 2;
                if (inGamut(oklabToRgbRaw(oklchToOklab([lch[0], mid, lch[2]])))) {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
            rgb = oklabToRgbRaw(oklchToOklab([lch[0], lo, lch[2]]));
        }
        return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])];
    }

    /* Shortest arc — but an achromatic endpoint has no meaningful hue, so
     * carry the other endpoint's instead, or white to red spins through
     * arbitrary hues on the way. */
    function mixHue(h1, h2, c1, c2, t) {
        var d, h;
        if (c1 < CHROMA_EPS && c2 < CHROMA_EPS) { return h1; }
        if (c1 < CHROMA_EPS) { h1 = h2; }
        else if (c2 < CHROMA_EPS) { h2 = h1; }
        d = h2 - h1;
        while (d > 180) { d -= 360; }
        while (d < -180) { d += 360; }
        h = h1 + d * t;
        while (h < 0) { h += 360; }
        while (h >= 360) { h -= 360; }
        return h;
    }

    function rgbToHsl(rgb) {
        var r = rgb[0], g = rgb[1], b = rgb[2];
        var max = Math.max(r, g, b), min = Math.min(r, g, b);
        var l = (max + min) / 2, h = 0, s = 0, d = max - min;
        if (d > 1e-9) {
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) { h = ((g - b) / d + (g < b ? 6 : 0)) * 60; }
            else if (max === g) { h = ((b - r) / d + 2) * 60; }
            else { h = ((r - g) / d + 4) * 60; }
        }
        return [h, s, l];
    }
    function hue2rgb(p, q, t) {
        if (t < 0) { t += 1; }
        if (t > 1) { t -= 1; }
        if (t < 1 / 6) { return p + (q - p) * 6 * t; }
        if (t < 1 / 2) { return q; }
        if (t < 2 / 3) { return p + (q - p) * (2 / 3 - t) * 6; }
        return p;
    }
    function hslToRgb(hsl) {
        var h = hsl[0] / 360, s = hsl[1], l = hsl[2], q, p;
        if (s < 1e-9) { return [l, l, l]; }
        q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        p = 2 * l - q;
        return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
    }

    function interpolate(a, b, t, space) {
        var i, out, A, B, h, rgb, La, Lb;
        if (space === "rgb") {
            out = [];
            for (i = 0; i < 3; i++) { out[i] = clamp01(a[i] + (b[i] - a[i]) * t); }
            return out;
        }
        if (space === "hsl") {
            A = rgbToHsl(a);
            B = rgbToHsl(b);
            h = mixHue(A[0], B[0], A[1], B[1], t);
            rgb = hslToRgb([h, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
            return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])];
        }
        La = oklabToOklch(rgbToOklab(a));
        Lb = oklabToOklch(rgbToOklab(b));
        return oklchToRgb([
            La[0] + (Lb[0] - La[0]) * t,
            La[1] + (Lb[1] - La[1]) * t,
            mixHue(La[2], Lb[2], La[1], Lb[1], t)
        ]);
    }

    /* Stops are evenly spaced, so position is implied by index. */
    function stopsFromColors(list) {
        var out = [], i;
        for (i = 0; i < list.length; i++) {
            out.push({
                t: list.length === 1 ? 0 : i / (list.length - 1),
                rgb: list[i]
            });
        }
        return out;
    }

    function sampleStops(stops, t, space) {
        var j, span, local;
        if (!stops.length) { return [0, 0, 0]; }
        if (stops.length === 1) { return stops[0].rgb; }
        if (t <= stops[0].t) { return stops[0].rgb; }
        if (t >= stops[stops.length - 1].t) { return stops[stops.length - 1].rgb; }
        for (j = 0; j < stops.length - 1; j++) {
            if (t <= stops[j + 1].t) {
                span = stops[j + 1].t - stops[j].t;
                local = span < 1e-9 ? 0 : (t - stops[j].t) / span;
                return interpolate(stops[j].rgb, stops[j + 1].rgb, local, space);
            }
        }
        return stops[stops.length - 1].rgb;
    }

    /* n discrete colors spanning the whole ramp. */
    function rampColors(stops, n, space) {
        var out = [], i;
        if (n <= 0) { return out; }
        if (n === 1) { return [stops.length ? stops[0].rgb : [0, 0, 0]]; }
        for (i = 0; i < n; i++) {
            out.push(sampleStops(stops, i / (n - 1), space));
        }
        return out;
    }

    /* Adding a stop resamples every stop at its new even position, so the
     * gradient shape survives the add. Two to three stops is exact. */
    function addStop(colors, space) {
        var stops = stopsFromColors(colors);
        var m = colors.length + 1;
        var next = [], i;
        for (i = 0; i < m; i++) {
            next.push(sampleStops(stops, i / (m - 1), space));
        }
        return next;
    }

    /* Removing takes the last INTERIOR stop, so the end colors that define
     * the ramp's extent survive, and add-then-remove round-trips exactly. */
    function removeStop(colors) {
        var next = [], i, drop = colors.length - 2;
        for (i = 0; i < colors.length; i++) {
            if (i !== drop) { next.push(colors[i]); }
        }
        return next;
    }

    function rgbToHex(rgb) {
        var s = "#", i, v;
        for (i = 0; i < 3; i++) {
            v = Math.round(clamp01(rgb[i]) * 255).toString(16).toUpperCase();
            s += v.length === 1 ? "0" + v : v;
        }
        return s;
    }

    function hexToRgb(hex) {
        var h = String(hex).replace(/^#/, ""), i, v, out = [];
        if (h.length !== 6) { return null; }
        for (i = 0; i < 3; i++) {
            v = parseInt(h.substring(i * 2, i * 2 + 2), 16);
            if (isNaN(v)) { return null; }
            out.push(v / 255);
        }
        return out;
    }

    function integerToRgb(value) {
        return [
            ((value >> 16) & 255) / 255,
            ((value >> 8) & 255) / 255,
            (value & 255) / 255
        ];
    }

    function serializeStops(colors) {
        var parts = [], i;
        for (i = 0; i < colors.length; i++) { parts.push(rgbToHex(colors[i])); }
        return parts.join(",");
    }

    /* Defensive: a malformed, short, or over-long stored list falls back to
     * the caller's default rather than throwing at panel startup. */
    function parseStops(text, minStops, maxStops) {
        var parts, out = [], i, rgb;
        if (!text) { return null; }
        parts = String(text).split(",");
        if (parts.length < minStops || parts.length > maxStops) { return null; }
        for (i = 0; i < parts.length; i++) {
            rgb = hexToRgb(trimString(parts[i]));
            if (!rgb) { return null; }
            out.push(rgb);
        }
        return out;
    }

    function trimString(s) {
        return String(s).replace(/^\s+/, "").replace(/\s+$/, "");
    }

    /* Project a comp-space point onto the ramp axis. AE's Y axis points
     * down, hence the negated sine: at 90 degrees this returns -y, so
     * sorting ascending puts the largest y (bottom of frame) first, which is
     * what the "bottom to top" arrow promises. */
    function projectPoint(x, y, angleDegrees) {
        var rad = angleDegrees * Math.PI / 180;
        return x * Math.cos(rad) - y * Math.sin(rad);
    }

    /* Returns null for anything that is not a real angle, so the caller can
     * revert rather than accept a bogus one. Empty input must be rejected
     * explicitly: Number("") is 0, so clearing the field would otherwise
     * read as a deliberate "0 degrees". */
    function normalizeAngle(deg) {
        var s, v;
        s = trimString((deg === null || deg === undefined) ? "" : deg);
        if (s === "") { return null; }
        v = Number(s);
        if (isNaN(v) || !isFinite(v)) { return null; }
        v = v % 360;
        if (v < 0) { v += 360; }
        return v;
    }
    /*__SPECTRUM_MATH_END__*/

    /* ----------------------------------------------------------------------
     * Settings
     * ------------------------------------------------------------------- */

    function saveSetting(key, value) {
        try {
            app.settings.saveSetting(SETTINGS_SECTION, key, String(value));
        } catch (saveError) {}
    }

    function readSetting(key) {
        try {
            if (app.settings.haveSetting(SETTINGS_SECTION, key)) {
                return app.settings.getSetting(SETTINGS_SECTION, key);
            }
        } catch (readError) {}
        return null;
    }

    function readBoolSetting(key, fallback) {
        var v = readSetting(key);
        if (v === null) { return fallback; }
        return v === "true";
    }

    /* ----------------------------------------------------------------------
     * Live panel state
     * ------------------------------------------------------------------- */

    var state = {
        colors: null,
        orderMode: "layer",   /* "layer" | "spatial" */
        angle: 0,
        space: "oklch",       /* "oklch" | "hsl" | "rgb" */
        keyMode: "skip",      /* "skip" | "key" */
        targetFill: true,
        targetStroke: false,
        targetEffect: false
    };

    function defaultColors() {
        var out = [], i;
        for (i = 0; i < DEFAULT_STOP_HEXES.length; i++) {
            out.push(hexToRgb(DEFAULT_STOP_HEXES[i]));
        }
        return out;
    }

    function loadState() {
        var stored = parseStops(readSetting("stops"), MIN_STOPS, MAX_STOPS);
        var mode, angle, space, keyMode;

        state.colors = stored ? stored : defaultColors();

        mode = readSetting("orderMode");
        state.orderMode = (mode === "spatial") ? "spatial" : "layer";

        angle = normalizeAngle(readSetting("angle"));
        state.angle = (angle === null) ? 0 : angle;

        space = readSetting("space");
        state.space = (space === "hsl" || space === "rgb") ? space : "oklch";

        keyMode = readSetting("keyMode");
        state.keyMode = (keyMode === "key") ? "key" : "skip";

        state.targetFill = readBoolSetting("targetFill", true);
        state.targetStroke = readBoolSetting("targetStroke", false);
        state.targetEffect = readBoolSetting("targetEffect", false);

        /* Never leave every target off: Apply would have nothing to do and
         * the panel would look broken on a fresh open. */
        if (!state.targetFill && !state.targetStroke && !state.targetEffect) {
            state.targetFill = true;
        }
    }

    function persistStops() { saveSetting("stops", serializeStops(state.colors)); }

    /* ----------------------------------------------------------------------
     * After Effects: selection, ordering, writing
     * ------------------------------------------------------------------- */

    function activeComp() {
        var item = null;
        try { item = app.project ? app.project.activeItem : null; } catch (e) {}
        if (item && item instanceof CompItem) { return item; }
        return null;
    }

    function selectedLayers() {
        var comp = activeComp(), out = [], i, sel;
        if (!comp) { return out; }
        try { sel = comp.selectedLayers; } catch (e) { return out; }
        for (i = 0; i < sel.length; i++) { out.push(sel[i]); }
        return out;
    }

    /* Count without copying the array — refresh() runs on every mouseover,
     * and this is the only thing it needs from the selection. */
    function selectionCount() {
        var comp = activeComp();
        if (!comp) { return 0; }
        try { return comp.selectedLayers.length; } catch (e) { return 0; }
    }

    /*__SPECTRUM_ENGINE_BEGIN__*/
    /* ----------------------------------------------------------------------
     * Ordering and writing. This block reads AE objects but creates none, so
     * test/tests.js slices it out and runs it against stub layers. It may use
     * `state`, `app`, `PropertyValueType`, `EFFECT_NAME` and `DIRECTION_NAMES`
     * — all of which the harness injects — but must not reach for the project
     * or the selection.
     * ------------------------------------------------------------------- */

    /* Comp-space position of a layer's anchor point, for spatial ordering.
     *
     * `layer.position` is measured in the PARENT's coordinate space, so a
     * parented layer's raw position says nothing about where it sits in the
     * comp — order by it and a parented grid sorts scrambled.
     *
     * Expressions solve this with toWorld(). Scripting has no equivalent,
     * and sourcePointToComp() is documented for layers with a footage
     * source, so it is no help on a shape layer — which is exactly what
     * this panel is usually pointed at. So compose the parent chain by
     * hand: a layer's position IS its anchor point expressed in its
     * parent's space, so mapping that point up through each ancestor in
     * turn lands it in comp space.
     *
     * 3D caveat: X and Y rotation and Z depth are not composed, so a
     * parent rotated out of plane sorts approximately. Translation, scale
     * and Z rotation are exact, which covers 2D layouts completely. */
    function compAnchor(layer, comp) {
        var t = 0, p, parent = null, guard = 0;

        try { t = comp.time; } catch (timeError) { t = 0; }

        p = valueAt(layer, "position", t, [0, 0, 0]);
        try { parent = layer.parent; } catch (parentError) { parent = null; }

        /* AE forbids parent cycles, but never loop on project data without
         * a bound. */
        while (parent && guard < 32) {
            p = pointToParentSpace(parent, p, t);
            try { parent = parent.parent; } catch (walkError) { parent = null; }
            guard++;
        }

        return [p[0], p[1]];
    }

    function valueAt(layer, name, t, fallback) {
        var prop = null, v;
        try { prop = layer[name]; } catch (missing) { return fallback; }
        if (!prop) { return fallback; }
        try {
            v = prop.valueAtTime(t, false);
        } catch (timeError) {
            try { v = prop.value; } catch (valueError) { return fallback; }
        }
        return (v === undefined || v === null) ? fallback : v;
    }

    /* Map a point from a layer's own coordinate space — the space its
     * children are positioned in — up into that layer's parent space. */
    function pointToParentSpace(layer, point, t) {
        var anchor = valueAt(layer, "anchorPoint", t, [0, 0, 0]);
        var position = valueAt(layer, "position", t, [0, 0, 0]);
        var scale = valueAt(layer, "scale", t, [100, 100, 100]);
        var rotation = valueAt(layer, "rotation", t, 0);
        var vx, vy, rad, cos, sin;

        vx = (point[0] - anchor[0]) * (scale[0] / 100);
        vy = (point[1] - anchor[1]) * (scale[1] / 100);

        rad = (typeof rotation === "number" ? rotation : 0) * Math.PI / 180;
        cos = Math.cos(rad);
        sin = Math.sin(rad);

        return [
            position[0] + vx * cos - vy * sin,
            position[1] + vx * sin + vy * cos
        ];
    }

    function orderLayers(layers, comp) {
        var decorated = [], i, pt, sorted;

        for (i = 0; i < layers.length; i++) {
            pt = (state.orderMode === "spatial")
                ? compAnchor(layers[i], comp)
                : [0, 0];
            decorated.push({
                layer: layers[i],
                index: layers[i].index,
                key: (state.orderMode === "spatial")
                    ? projectPoint(pt[0], pt[1], state.angle)
                    : layers[i].index
            });
        }

        /* Ties fall back to layer index so the order is stable and
         * repeatable — perfectly stacked layers must not shuffle. */
        decorated.sort(function (a, b) {
            if (a.key < b.key) { return -1; }
            if (a.key > b.key) { return 1; }
            return a.index - b.index;
        });

        sorted = [];
        for (i = 0; i < decorated.length; i++) { sorted.push(decorated[i].layer); }
        return sorted;
    }

    /* Match the array length AE expects rather than hardcoding it, and carry
     * the existing alpha through. Sizing value arrays from the property is
     * the lesson recorded in docs/jsx-design-principles.md §2. */
    function colorValueFor(prop, rgb) {
        var current = null;
        try { current = prop.value; } catch (e) {}
        if (current && current.length === 4) {
            return [rgb[0], rgb[1], rgb[2], current[3]];
        }
        return [rgb[0], rgb[1], rgb[2]];
    }

    function newTally() {
        return {
            layers: 0,      /* layers where at least one property was written */
            colored: 0,     /* properties written with setValue */
            gradient: 0,
            expression: 0,
            animated: 0,
            keyframed: 0,   /* properties written with setValueAtTime */
            empty: 0
        };
    }

    /* Classify one color property and either write it or count why not. */
    function writeColor(prop, rgb, comp, tally) {
        if (!prop) { return; }

        try {
            if (prop.expressionEnabled) { tally.expression++; return; }
        } catch (e) {}

        var keyed = 0;
        try { keyed = prop.numKeys; } catch (e2) { keyed = 0; }

        if (keyed > 0) {
            if (state.keyMode === "key") {
                try {
                    prop.setValueAtTime(comp.time, colorValueFor(prop, rgb));
                    tally.keyframed++;
                } catch (e3) {
                    tally.animated++;
                }
            } else {
                tally.animated++;
            }
            return;
        }

        try {
            prop.setValue(colorValueFor(prop, rgb));
            tally.colored++;
        } catch (e4) {
            tally.animated++;
        }
    }

    /* Walk a shape layer's contents collecting paint operators. Groups nest,
     * so this recurses; gradient fills are counted, never written, because
     * gradient stops cannot be set through scripting at all (§2). */
    function paintShapeLayer(group, rgb, comp, tally) {
        var i, p, mn, contents;
        if (!group) { return; }

        for (i = 1; i <= group.numProperties; i++) {
            p = null;
            try { p = group.property(i); } catch (e) { continue; }
            if (!p) { continue; }

            mn = "";
            try { mn = p.matchName; } catch (e2) { continue; }

            if (mn === "ADBE Vector Group") {
                contents = null;
                try { contents = p.property("ADBE Vectors Group"); } catch (e3) {}
                paintShapeLayer(contents, rgb, comp, tally);
            } else if (mn === "ADBE Vectors Group") {
                paintShapeLayer(p, rgb, comp, tally);
            } else if (mn === "ADBE Vector Graphic - Fill" && state.targetFill) {
                writeColor(safeProp(p, "ADBE Vector Fill Color"), rgb, comp, tally);
            } else if (mn === "ADBE Vector Graphic - Stroke" && state.targetStroke) {
                writeColor(safeProp(p, "ADBE Vector Stroke Color"), rgb, comp, tally);
            } else if (mn === "ADBE Vector Graphic - G-Fill" && state.targetFill) {
                tally.gradient++;
            } else if (mn === "ADBE Vector Graphic - G-Stroke" && state.targetStroke) {
                tally.gradient++;
            }
        }
    }

    function safeProp(parent, name) {
        try { return parent.property(name); } catch (e) { return null; }
    }

    /* Reuse a Spectrum Fill effect if one is already on the layer — otherwise
     * re-applying would stack a new Fill effect every run. */
    function spectrumFillEffect(layer) {
        var fx = safeProp(layer, "ADBE Effect Parade"), existing, added;
        if (!fx) { return null; }

        existing = safeProp(fx, EFFECT_NAME);
        if (existing) { return existing; }

        try {
            if (!fx.canAddProperty("ADBE Fill")) { return null; }
            added = fx.addProperty("ADBE Fill");
            added.name = EFFECT_NAME;
            return added;
        } catch (e) {
            return null;
        }
    }

    /* The Color sub-property's match name is not worth trusting across AE
     * versions: try the documented names, then fall back to the first
     * COLOR-typed property on the effect. */
    function effectColorProperty(effect) {
        var names = ["Color", "ADBE Fill-0002"], i, p;

        for (i = 0; i < names.length; i++) {
            p = safeProp(effect, names[i]);
            if (p && isColorProperty(p)) { return p; }
        }

        try {
            for (i = 1; i <= effect.numProperties; i++) {
                p = effect.property(i);
                if (p && isColorProperty(p)) { return p; }
            }
        } catch (e) {}

        return null;
    }

    function isColorProperty(p) {
        try {
            return p.propertyValueType === PropertyValueType.COLOR;
        } catch (e) {
            return false;
        }
    }

    function applyToLayer(layer, rgb, comp, tally) {
        var written = tally.colored + tally.keyframed;
        var touched = written + tally.animated + tally.expression + tally.gradient;
        var root, effect, colorProp;

        if (state.targetFill || state.targetStroke) {
            root = safeProp(layer, "ADBE Root Vectors Group");
            if (root) { paintShapeLayer(root, rgb, comp, tally); }
        }

        if (state.targetEffect) {
            effect = spectrumFillEffect(layer);
            if (effect) {
                colorProp = effectColorProperty(effect);
                writeColor(colorProp, rgb, comp, tally);
            }
        }

        /* A layer counts once however many fills it holds — "colored 22
         * layers" is the number the user can check against the timeline,
         * whereas a property count silently inflates on multi-fill shapes. */
        if (tally.colored + tally.keyframed > written) { tally.layers++; }

        if (tally.colored + tally.keyframed + tally.animated +
            tally.expression + tally.gradient === touched) {
            tally.empty++;
        }
    }

    /* Skips are named and counted, never silent: a no-op on 3 of 25 layers
     * that reads as success is the worst possible outcome. */
    function describeTally(tally, layerCount) {
        var notes = [], targets = [], msg;

        if (state.targetFill) { targets.push("fills"); }
        if (state.targetStroke) { targets.push("strokes"); }
        if (state.targetEffect) { targets.push("Fill effect"); }

        msg = "Colored " + tally.layers +
            (tally.layers === 1 ? " layer" : " layers") +
            " of " + layerCount +
            " (" + targets.join(" + ") + ", " + orderLabel() + ").";

        if (tally.keyframed) {
            msg += " Keyframed " + tally.keyframed + " at the playhead.";
        }

        if (tally.animated) { notes.push(tally.animated + " animated"); }
        if (tally.expression) { notes.push(tally.expression + " expression-driven"); }
        if (tally.gradient) { notes.push(tally.gradient + " gradient"); }
        if (tally.empty) {
            notes.push(tally.empty + " with no matching " +
                (targets.length === 1 ? targets[0] : "target"));
        }

        if (notes.length) { msg += " Skipped: " + notes.join(", ") + "."; }
        return msg;
    }

    function orderLabel() {
        if (state.orderMode === "layer") { return "layer order"; }
        var name = DIRECTION_NAMES[String(state.angle)];
        return name ? name : (state.angle + " degrees");
    }

    /* Eyedropper: read the first colorable fill off a layer. */
    function firstFillColor(layer) {
        var root = safeProp(layer, "ADBE Root Vectors Group");
        return root ? findFillColor(root) : null;
    }

    function findFillColor(group) {
        var i, p, mn, contents, found, value;
        for (i = 1; i <= group.numProperties; i++) {
            p = null;
            try { p = group.property(i); } catch (e) { continue; }
            if (!p) { continue; }

            mn = "";
            try { mn = p.matchName; } catch (e2) { continue; }

            if (mn === "ADBE Vector Group") {
                contents = safeProp(p, "ADBE Vectors Group");
                if (contents) {
                    found = findFillColor(contents);
                    if (found) { return found; }
                }
            } else if (mn === "ADBE Vectors Group") {
                found = findFillColor(p);
                if (found) { return found; }
            } else if (mn === "ADBE Vector Graphic - Fill") {
                try {
                    value = p.property("ADBE Vector Fill Color").value;
                    if (value && value.length >= 3) {
                        return [value[0], value[1], value[2]];
                    }
                } catch (e3) {}
            }
        }
        return null;
    }
    /*__SPECTRUM_ENGINE_END__*/

    /* Orchestration. Kept outside the engine block because it reaches for the
     * project and the selection, which the test harness does not stub. */
    function applyRamp() {
        var comp = activeComp(), layers, ordered, colors, tally, i, stops;

        if (!comp) { return "Open a composition first."; }

        layers = selectedLayers();
        if (!layers.length) { return "Select one or more layers first."; }

        if (!state.targetFill && !state.targetStroke && !state.targetEffect) {
            return "Choose at least one target: Fill, Stroke, or Fill effect.";
        }

        stops = stopsFromColors(state.colors);
        colors = rampColors(stops, layers.length, state.space);
        tally = newTally();

        app.beginUndoGroup("Apply Spectrum Ramp");
        try {
            ordered = orderLayers(layers, comp);
            for (i = 0; i < ordered.length; i++) {
                applyToLayer(ordered[i], colors[i], comp, tally);
            }
        } finally {
            app.endUndoGroup();
        }

        return describeTally(tally, layers.length);
    }

    /* ----------------------------------------------------------------------
     * Drawing helpers
     *
     * Every tile and the Apply button are painted with onDraw, which replaces
     * all native painting: no toolbutton chrome, no OS focus ring (§2). The
     * glyphs here are geometric primitives — arrows, bars, an eyedropper — so
     * they are drawn directly rather than shipped as baked PNGs. That keeps
     * the panel a single file with no dependency on "Allow Scripts to Write
     * Files", which the temp-file icon route requires.
     *
     * Every draw is wrapped in try/catch: a failed paint must still leave a
     * working control.
     * ------------------------------------------------------------------- */

    function fillRect(g, x, y, w, h, color) {
        g.newPath();
        g.rectPath(x, y, w, h);
        g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, color));
    }

    function strokeRect(g, x, y, w, h, color) {
        g.newPath();
        g.rectPath(x, y, w, h);
        g.strokePath(g.newPen(g.PenType.SOLID_COLOR, color, 1));
    }

    function polygon(g, points, color, filled, width) {
        var i;
        g.newPath();
        g.moveTo(points[0][0], points[0][1]);
        for (i = 1; i < points.length; i++) { g.lineTo(points[i][0], points[i][1]); }
        g.closePath();
        if (filled) {
            g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, color));
        } else {
            g.strokePath(g.newPen(g.PenType.SOLID_COLOR, color, width || 1));
        }
    }

    /* Arrow pointing along `angle`, measured counter-clockwise from east so
     * that 90 reads as up on screen. Screen Y grows downward, hence -sin. */
    function drawArrow(g, size, angle, color) {
        var rad = angle * Math.PI / 180;
        var dx = Math.cos(rad), dy = -Math.sin(rad);
        var px = -dy, py = dx;
        var cx = size / 2, cy = size / 2;
        var reach = 6.2, head = 4.4, halfHead = 3.1, halfShaft = 0.9;
        var tipX = cx + dx * reach, tipY = cy + dy * reach;
        var baseX = tipX - dx * head, baseY = tipY - dy * head;
        var tailX = cx - dx * reach, tailY = cy - dy * reach;

        polygon(g, [
            [tailX + px * halfShaft, tailY + py * halfShaft],
            [baseX + px * halfShaft, baseY + py * halfShaft],
            [baseX - px * halfShaft, baseY - py * halfShaft],
            [tailX - px * halfShaft, tailY - py * halfShaft]
        ], color, true);

        polygon(g, [
            [tipX, tipY],
            [baseX + px * halfHead, baseY + py * halfHead],
            [baseX - px * halfHead, baseY - py * halfHead]
        ], color, true);
    }

    /* Three stacked bars — timeline stacking order. */
    function drawStackGlyph(g, size, color) {
        var left = 4.5, right = size - 4.5, i, y;
        for (i = 0; i < 3; i++) {
            y = 5.5 + i * 4.5;
            fillRect(g, left, y, right - left, 2.2, color);
        }
    }

    /* Eyedropper: bulb, barrel, tapered tip. */
    function drawEyedropper(g, size, color) {
        var brush = g.newBrush(g.BrushType.SOLID_COLOR, color);
        var ax = 12.0, ay = 5.2, bx = 7.0, by = 10.2;
        var len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
        var dx = (bx - ax) / len, dy = (by - ay) / len;
        var px = -dy, py = dx;
        var halfW = 1.35, tipLen = 3.1;

        g.newPath();
        g.ellipsePath(ax + dx * -2.6 - 2.1, ay + dy * -2.6 - 2.1, 4.2, 4.2);
        g.fillPath(brush);

        polygon(g, [
            [ax + px * halfW, ay + py * halfW],
            [bx + px * halfW, by + py * halfW],
            [bx - px * halfW, by - py * halfW],
            [ax - px * halfW, ay - py * halfW]
        ], color, true);

        polygon(g, [
            [bx + px * halfW, by + py * halfW],
            [bx + dx * tipLen, by + dy * tipLen],
            [bx - px * halfW, by - py * halfW]
        ], color, true);
    }

    function paintTile(control, drawGlyph) {
        return function () {
            try {
                var g = this.graphics;
                var w = this.size[0], h = this.size[1];
                var on = control.spectrumSelected === true;
                var enabled = this.enabled !== false;

                fillRect(g, 0, 0, w, h, on ? COL_TILE_BG_ON : COL_TILE_BG);
                strokeRect(g, 0.5, 0.5, w - 1, h - 1,
                    on ? COL_TILE_EDGE_ON : COL_TILE_EDGE);
                drawGlyph(g, w, h,
                    !enabled ? COL_GLYPH_OFF : (on ? COL_GLYPH_ON : COL_GLYPH));
            } catch (tileDrawError) {}
        };
    }

    /* ----------------------------------------------------------------------
     * Panel
     * ------------------------------------------------------------------- */

    function lockSize(control, w, h) {
        control.preferredSize = [w, h];
        control.minimumSize = [w, h];
        control.maximumSize = [w, h];
    }

    /* A custom-drawn control does not repaint when its state changes
     * programmatically. Force it (§2). */
    function repaint(control) {
        try {
            control.visible = false;
            control.visible = true;
        } catch (e) {}
    }

    function buildUI(thisObj) {
        var win = (thisObj instanceof Panel)
            ? thisObj
            : new Window("palette", "Spectrum", undefined, { resizeable: true });

        var ui = {};
        var i;

        win.orientation = "column";
        win.alignChildren = ["fill", "top"];
        win.spacing = 6;
        win.margins = 8;

        /* --- Row 1: stops ------------------------------------------------ */
        var stopRow = win.add("group");
        stopRow.orientation = "row";
        stopRow.alignChildren = ["left", "center"];
        stopRow.spacing = 4;

        ui.swatches = [];
        for (i = 0; i < MAX_STOPS; i++) {
            ui.swatches.push(makeSwatch(stopRow, i));
        }

        addSpacer(stopRow, 5);
        ui.btnAdd = makeGlyphButton(stopRow, "+");
        ui.btnSub = makeGlyphButton(stopRow, "−");
        addSpacer(stopRow, 5);
        ui.btnRev = makeGlyphButton(stopRow, "⇄");
        ui.btnPick = makeDrawnButton(stopRow, function (g, w) {
            drawEyedropper(g, w, COL_GLYPH);
        });

        /* --- Row 2: preview strip ---------------------------------------- */
        ui.strip = win.add("button", undefined, "");
        ui.strip.preferredSize = [260, 16];
        ui.strip.minimumSize = [80, 16];
        ui.strip.maximumSize = [4000, 16];
        ui.strip.onDraw = function () {
            try {
                var g = this.graphics;
                var w = this.size[0], h = this.size[1];
                /* Read the cached count rather than querying the selection:
                 * onDraw runs on every paint, and walking the project from
                 * inside a paint handler is both slow and reentrant. */
                var n = previewStepCount;
                var cols = rampColors(stopsFromColors(state.colors), n, state.space);
                var x = 0, next, k;
                for (k = 0; k < cols.length; k++) {
                    next = Math.round((k + 1) * w / cols.length);
                    fillRect(g, x, 0, next - x, h, cols[k]);
                    x = next;
                }
                strokeRect(g, 0.5, 0.5, w - 1, h - 1, COL_TILE_EDGE);
            } catch (stripDrawError) {}
        };

        /* --- Row 3: order ------------------------------------------------ */
        var orderRow = win.add("group");
        orderRow.orientation = "row";
        orderRow.alignChildren = ["left", "center"];
        orderRow.spacing = 4;

        ui.tileLayer = makeTile(orderRow, function (g, w, h, color) {
            drawStackGlyph(g, w, color);
        });
        ui.tileLayer.helpTip = "Layer order: timeline stacking, top layer first.";

        addSpacer(orderRow, 5);

        ui.tiles = [];
        for (i = 0; i < DIRECTIONS.length; i++) {
            ui.tiles.push(makeDirectionTile(orderRow, DIRECTIONS[i]));
        }

        addSpacer(orderRow, 5);

        ui.angle = orderRow.add("edittext", undefined, "0");
        lockSize(ui.angle, 38, 20);
        ui.angle.helpTip = "Ramp direction in degrees. The tiles are shortcuts; " +
            "any angle is allowed.";

        var deg = orderRow.add("statictext", undefined, "°");
        lockSize(deg, 8, 18);

        /* --- Row 4: targets + settings ----------------------------------- */
        var targetRow = win.add("group");
        targetRow.orientation = "row";
        targetRow.alignChildren = ["left", "center"];
        targetRow.spacing = 6;

        ui.chkFill = targetRow.add("checkbox", undefined, "Fill");
        ui.chkFill.helpTip = "Set the color of every Fill in the shape layer's contents.";
        ui.chkStroke = targetRow.add("checkbox", undefined, "Stroke");
        ui.chkStroke.helpTip = "Set the color of every Stroke in the shape layer's contents.";
        ui.chkEffect = targetRow.add("checkbox", undefined, "Fill effect");
        ui.chkEffect.helpTip = "Add or update a \"" + EFFECT_NAME + "\" effect. " +
            "Works on any layer type, and floods the whole alpha.";

        addSpacer(targetRow, 5);
        ui.btnGear = makeGlyphButton(targetRow, "⚙");
        ui.btnGear.helpTip = "Spectrum settings…";

        /* --- Row 5: apply ------------------------------------------------ */
        ui.apply = win.add("button", undefined, "Apply");
        ui.apply.preferredSize = [260, 24];
        ui.apply.minimumSize = [80, 24];
        ui.apply.maximumSize = [4000, 24];
        ui.apply.onDraw = function () {
            try {
                var g = this.graphics;
                var w = this.size[0], h = this.size[1];
                var enabled = this.enabled !== false;
                var ds = arguments[0];
                var pressed = ds && ds.leftButtonPressed;
                var hovered = ds && ds.mouseOver;
                var top = COL_ACCENT_TOP, bot = COL_ACCENT_BOT, k;

                if (!enabled) {
                    fillRect(g, 0, 0, w, h, COL_DISABLED_BG);
                    strokeRect(g, 0.5, 0.5, w - 1, h - 1, COL_TILE_EDGE);
                } else {
                    if (pressed) { top = COL_ACCENT_BOT; bot = COL_ACCENT_EDGE; }
                    else if (hovered) { top = [0.561, 0.792, 0.949]; bot = [0.424, 0.690, 0.871]; }
                    /* Cheap vertical gradient: a few horizontal bands. */
                    for (k = 0; k < h; k++) {
                        fillRect(g, 0, k, w, 1, [
                            top[0] + (bot[0] - top[0]) * (k / h),
                            top[1] + (bot[1] - top[1]) * (k / h),
                            top[2] + (bot[2] - top[2]) * (k / h)
                        ]);
                    }
                    strokeRect(g, 0.5, 0.5, w - 1, h - 1, COL_ACCENT_EDGE);
                }

                /* Draw the label last, and never touch graphics.foregroundColor
                 * on the way — assigning it can throw, and a throw inside this
                 * try/catch would skip the label entirely and leave a blank
                 * accent bar. drawString takes its own pen. */
                var label = this.text;
                var pen = g.newPen(g.PenType.SOLID_COLOR,
                    enabled ? COL_ACCENT_TEXT : COL_DISABLED_TEXT, 1);
                var font = null, metrics = null, tw, th;

                try { font = g.font; } catch (fontError) { font = null; }
                try { metrics = g.measureString(label, font, w); } catch (mError) {}

                /* Roughly 6px per character is close enough to centre the
                 * label when the host cannot measure it. */
                tw = (metrics && metrics[0]) ? metrics[0] : label.length * 6;
                th = (metrics && metrics[1]) ? metrics[1] : 12;

                if (font) {
                    g.drawString(label, pen, (w - tw) / 2, (h - th) / 2, font);
                } else {
                    g.drawString(label, pen, (w - tw) / 2, (h - th) / 2);
                }
            } catch (applyDrawError) {}
        };

        /* --- Report ------------------------------------------------------ */
        ui.report = win.add("statictext", undefined, "", { multiline: true });
        ui.report.preferredSize = [260, 28];
        ui.report.minimumSize = [80, 28];
        ui.report.maximumSize = [4000, 28];

        wireEvents(win, ui);
        refresh(ui);

        if (win instanceof Window) {
            win.center();
            win.show();
        } else {
            win.layout.layout(true);
            win.layout.resize();
        }

        /* onResize must never throw, or AE reports it at panel restore (§2). */
        win.onResizing = win.onResize = function () {
            try { this.layout.resize(); } catch (resizeError) {}
        };

        return win;
    }

    function addSpacer(parent, width) {
        var s = parent.add("group");
        lockSize(s, width, 1);
        return s;
    }

    function makeSwatch(parent, index) {
        var sw = parent.add("group");
        lockSize(sw, SWATCH, SWATCH);
        sw.spectrumIndex = index;
        return sw;
    }

    function setSwatchColor(swatch, rgb) {
        /* Native background fill, no onDraw, so swatches keep painting while
         * the modal color picker is open (§2). */
        try {
            var g = swatch.graphics;
            g.backgroundColor = g.newBrush(g.BrushType.SOLID_COLOR, rgb);
        } catch (swatchError) {}
    }

    function makeGlyphButton(parent, glyph) {
        var b = parent.add("button", undefined, glyph);
        lockSize(b, TILE, TILE);
        return b;
    }

    function makeDrawnButton(parent, drawGlyph) {
        var b = parent.add("button", undefined, "");
        lockSize(b, TILE, TILE);
        b.onDraw = function () {
            try {
                var g = this.graphics;
                var w = this.size[0], h = this.size[1];
                fillRect(g, 0, 0, w, h, COL_TILE_BG);
                strokeRect(g, 0.5, 0.5, w - 1, h - 1, COL_TILE_EDGE);
                drawGlyph(g, w, h);
            } catch (drawError) {}
        };
        return b;
    }

    /* drawGlyph receives (graphics, width, height, color) and MUST use the
     * color it is handed — that argument is what carries the selected and
     * disabled states. */
    function makeTile(parent, drawGlyph) {
        var b = parent.add("button", undefined, "");
        lockSize(b, TILE, TILE);
        b.spectrumSelected = false;
        b.onDraw = paintTile(b, drawGlyph);
        return b;
    }

    function makeDirectionTile(parent, angle) {
        var b = parent.add("button", undefined, "");
        lockSize(b, TILE, TILE);
        b.spectrumSelected = false;
        b.spectrumAngle = angle;
        b.onDraw = paintTile(b, function (g, w, h, color) {
            drawArrow(g, w, angle, color);
        });
        b.helpTip = "Ramp " + DIRECTION_NAMES[String(angle)] + " (" + angle +
            "°) — the arrow points the way the ramp travels, " +
            "first stop at the tail.";
        return b;
    }

    /* Cached so onDraw never has to query the project. Updated by refresh. */
    var previewStepCount = NO_SELECTION_STEPS;
    var stripSignature = "";
    var applySignature = "";

    /* ----------------------------------------------------------------------
     * Refresh: one function drives every control from `state`.
     * ------------------------------------------------------------------- */

    /* Repaint only what actually changed. refresh() runs on every focus
     * event, and visible=false/true on eleven custom-drawn controls each time
     * reads as a flicker. */
    function repaintIfChanged(control, wasSelected) {
        if (control.spectrumSelected !== wasSelected) { repaint(control); }
    }

    function refresh(ui) {
        var i, sw, count = state.colors.length, n, was, sig;

        for (i = 0; i < MAX_STOPS; i++) {
            sw = ui.swatches[i];
            if (i < count) {
                sw.visible = true;
                setSwatchColor(sw, state.colors[i]);
                sw.helpTip = "Stop " + (i + 1) + " of " + count + ": " +
                    rgbToHex(state.colors[i]) + ". Click to choose a color" +
                    (count > MIN_STOPS
                        ? "; Option/Alt-click to remove this stop."
                        : ".");
            } else {
                sw.visible = false;
            }
        }

        ui.btnAdd.enabled = count < MAX_STOPS;
        ui.btnSub.enabled = count > MIN_STOPS;
        ui.btnAdd.helpTip = ui.btnAdd.enabled
            ? "Add a stop, sampled from the current ramp so the gradient does not jump."
            : "Maximum of " + MAX_STOPS + " stops reached.";
        ui.btnSub.helpTip = ui.btnSub.enabled
            ? "Remove the last interior stop, keeping both end colors."
            : "A ramp needs at least " + MIN_STOPS + " stops.";
        ui.btnRev.helpTip = "Reverse the ramp — swaps the stop order in place.";
        ui.btnPick.helpTip = "Eyedropper: sample the existing fill colors of the " +
            "first and last selected layers into the end stops.";

        was = ui.tileLayer.spectrumSelected;
        ui.tileLayer.spectrumSelected = (state.orderMode === "layer");
        repaintIfChanged(ui.tileLayer, was);

        for (i = 0; i < ui.tiles.length; i++) {
            was = ui.tiles[i].spectrumSelected;
            ui.tiles[i].spectrumSelected = (state.orderMode === "spatial") &&
                (ui.tiles[i].spectrumAngle === state.angle);
            repaintIfChanged(ui.tiles[i], was);
        }

        ui.angle.enabled = (state.orderMode === "spatial");
        if (ui.angle.text !== String(state.angle)) {
            ui.angle.text = String(state.angle);
        }

        ui.chkFill.value = state.targetFill;
        ui.chkStroke.value = state.targetStroke;
        ui.chkEffect.value = state.targetEffect;

        n = selectionCount();
        previewStepCount = n > 0 ? n : NO_SELECTION_STEPS;

        /* Apply is NEVER disabled. A ScriptUI panel gets no notification when
         * the timeline selection changes, so this count is a hint that can be
         * stale — and gating the primary action on a stale hint deadlocks the
         * panel: a disabled button cannot be clicked, so clicking it cannot
         * trigger the refresh that would re-enable it. Apply re-reads the live
         * selection on click and reports for itself if there is nothing there. */
        ui.apply.text = n > 0
            ? "Apply to " + n + (n === 1 ? " layer" : " layers")
            : "Apply Ramp";
        ui.apply.helpTip = n > 0
            ? "Distribute the ramp across " + n + " layers, " + orderLabel() + "."
            : "Distribute the ramp across the selected layers, " +
              orderLabel() + ".";

        sig = ui.apply.text;
        if (sig !== applySignature) {
            applySignature = sig;
            repaint(ui.apply);
        }

        ui.strip.helpTip = n > 0
            ? n + " steps — one per selected layer."
            : "Showing " + NO_SELECTION_STEPS + " sample steps until layers " +
              "are selected.";

        sig = serializeStops(state.colors) + "|" + state.space + "|" +
            previewStepCount;
        if (sig !== stripSignature) {
            stripSignature = sig;
            repaint(ui.strip);
        }
    }

    function say(ui, message) {
        try { ui.report.text = message; } catch (e) {}
    }

    /* ----------------------------------------------------------------------
     * Events
     * ------------------------------------------------------------------- */

    function wireEvents(win, ui) {
        var i;

        for (i = 0; i < MAX_STOPS; i++) {
            wireSwatch(ui, ui.swatches[i]);
        }

        ui.btnAdd.onClick = function () {
            if (state.colors.length >= MAX_STOPS) { return; }
            state.colors = addStop(state.colors, state.space);
            persistStops();
            refresh(ui);
        };

        ui.btnSub.onClick = function () {
            if (state.colors.length <= MIN_STOPS) { return; }
            state.colors = removeStop(state.colors);
            persistStops();
            refresh(ui);
        };

        ui.btnRev.onClick = function () {
            state.colors.reverse();
            persistStops();
            refresh(ui);
        };

        ui.btnPick.onClick = function () { eyedrop(ui); };

        ui.tileLayer.onClick = function () {
            state.orderMode = "layer";
            saveSetting("orderMode", "layer");
            refresh(ui);
        };

        for (i = 0; i < ui.tiles.length; i++) {
            wireDirectionTile(ui, ui.tiles[i]);
        }

        ui.angle.onChange = function () {
            var v = normalizeAngle(ui.angle.text);
            if (v === null) {
                ui.angle.text = String(state.angle);
                return;
            }
            state.angle = v;
            state.orderMode = "spatial";
            saveSetting("angle", v);
            saveSetting("orderMode", "spatial");
            refresh(ui);
        };

        ui.chkFill.onClick = function () {
            state.targetFill = ui.chkFill.value;
            saveSetting("targetFill", state.targetFill);
            refresh(ui);
        };
        ui.chkStroke.onClick = function () {
            state.targetStroke = ui.chkStroke.value;
            saveSetting("targetStroke", state.targetStroke);
            refresh(ui);
        };
        ui.chkEffect.onClick = function () {
            state.targetEffect = ui.chkEffect.value;
            saveSetting("targetEffect", state.targetEffect);
            refresh(ui);
        };

        ui.btnGear.onClick = function () { showSettings(ui); };

        ui.apply.onClick = function () {
            say(ui, applyRamp());
            refresh(ui);
        };

        /* Selection tracking.
         *
         * After Effects gives a ScriptUI panel no callback when the timeline
         * selection changes, so the panel has to re-read it opportunistically.
         * `focus` alone is not enough: it does not fire while you select
         * layers in the timeline, so the panel's count goes stale the moment
         * you touch the comp.
         *
         * `mouseover` in the capture phase catches the pointer entering the
         * panel or any of its children — and moving the pointer here is the
         * one thing that always precedes using the panel. That makes the
         * count fresh by the time you can read it. A no-change refresh is
         * cheap: it queries a count and compares two signatures. */
        win.addEventListener("mouseover", function () {
            try { refresh(ui); } catch (hoverError) {}
        }, true);

        win.addEventListener("focus", function () {
            try { refresh(ui); } catch (focusError) {}
        });
    }

    function wireSwatch(ui, swatch) {
        swatch.addEventListener("mousedown", function (event) {
            var index = swatch.spectrumIndex, picked;

            if (index >= state.colors.length) { return; }

            if (event && event.altKey) {
                if (state.colors.length <= MIN_STOPS) {
                    say(ui, "A ramp needs at least " + MIN_STOPS + " stops.");
                    return;
                }
                state.colors.splice(index, 1);
                persistStops();
                refresh(ui);
                return;
            }

            picked = $.colorPicker();
            if (picked >= 0) {
                state.colors[index] = integerToRgb(picked);
                persistStops();
                refresh(ui);
            }
        });
    }

    function wireDirectionTile(ui, tile) {
        tile.onClick = function () {
            state.orderMode = "spatial";
            state.angle = tile.spectrumAngle;
            saveSetting("orderMode", "spatial");
            saveSetting("angle", state.angle);
            refresh(ui);
        };
    }

    function eyedrop(ui) {
        var layers = selectedLayers(), first, last, firstHex, lastHex;

        if (!layers.length) {
            say(ui, "Nothing selected. Select the layers to sample colors from.");
            return;
        }

        first = firstFillColor(layers[0]);
        last = firstFillColor(layers[layers.length - 1]);

        if (!first && !last) {
            say(ui, "No shape-layer fills found on the selected layers to sample.");
            return;
        }
        if (!first) { first = last; }
        if (!last) { last = first; }

        state.colors[0] = first;
        state.colors[state.colors.length - 1] = last;
        persistStops();
        refresh(ui);

        firstHex = rgbToHex(first);
        lastHex = rgbToHex(last);

        say(ui, layers.length === 1
            ? "Sampled " + firstHex + " from the only selected layer — both " +
              "end stops now match. Select two or more to sample a range."
            : "Sampled " + firstHex + " from " + layers[0].name + " and " +
              lastHex + " from " + layers[layers.length - 1].name + ".");
    }

    /* ----------------------------------------------------------------------
     * Settings dialog
     *
     * Opened only from the gear handler. AE blocks dialogs while panels
     * restore at launch and reports a cryptic "line 0" error, so this must
     * never run during startup (§2).
     * ------------------------------------------------------------------- */

    var SPACE_ITEMS = [
        "OKLCH — perceptual (default)",
        "HSL — vivid hue path",
        "RGB — matches AE gradients"
    ];
    var SPACE_KEYS = ["oklch", "hsl", "rgb"];

    var KEY_ITEMS = [
        "Skip and report (default)",
        "Set a keyframe at the playhead"
    ];
    var KEY_KEYS = ["skip", "key"];

    function indexOfKey(keys, value) {
        var i;
        for (i = 0; i < keys.length; i++) {
            if (keys[i] === value) { return i; }
        }
        return 0;
    }

    function showSettings(ui) {
        var dlg, spaceList, keyList, hint1, hint2, buttons, ok, cancel, i;

        dlg = new Window("dialog", "Spectrum Settings");
        dlg.orientation = "column";
        dlg.alignChildren = ["fill", "top"];
        dlg.spacing = 8;
        dlg.margins = 14;

        dlg.add("statictext", undefined, "Interpolation space");
        spaceList = dlg.add("dropdownlist", undefined, SPACE_ITEMS);
        spaceList.selection = indexOfKey(SPACE_KEYS, state.space);
        hint1 = dlg.add("statictext", undefined,
            "OKLCH keeps steps perceptually even and avoids the gray middle " +
            "on complementary pairs. Change only to match an existing look.",
            { multiline: true });
        hint1.preferredSize = [260, 30];

        dlg.add("statictext", undefined, "Animated colors");
        keyList = dlg.add("dropdownlist", undefined, KEY_ITEMS);
        keyList.selection = indexOfKey(KEY_KEYS, state.keyMode);
        hint2 = dlg.add("statictext", undefined,
            "A color property with keyframes cannot take a plain value. Skip " +
            "leaves the animation untouched; keyframing writes the ramp color " +
            "at the current time.",
            { multiline: true });
        hint2.preferredSize = [260, 40];

        buttons = dlg.add("group");
        buttons.orientation = "row";
        buttons.alignment = ["fill", "top"];
        cancel = buttons.add("button", undefined, "Cancel", { name: "cancel" });
        ok = buttons.add("button", undefined, "OK", { name: "ok" });

        ok.onClick = function () {
            i = spaceList.selection ? spaceList.selection.index : 0;
            state.space = SPACE_KEYS[i];
            saveSetting("space", state.space);

            i = keyList.selection ? keyList.selection.index : 0;
            state.keyMode = KEY_KEYS[i];
            saveSetting("keyMode", state.keyMode);

            dlg.close(1);
        };
        cancel.onClick = function () { dlg.close(0); };

        if (dlg.show() === 1) {
            refresh(ui);
            say(ui, "Interpolating in " + state.space.toUpperCase() + ".");
        }
    }

    /* ------------------------------------------------------------------- */

    loadState();
    buildUI(thisObj);

})(this);
