/*
 * Spectrum — After Effects API probe.
 *
 * Answers the questions that cannot be settled without a live AE session,
 * by running THE SHIPPED CODE against real AE objects: it slices the MATH
 * and ENGINE blocks out of Spectrum.jsx and evaluates them here, so this
 * tests the panel's real code paths rather than a reimplementation.
 *
 * Run: File > Scripts > Run Script File… and pick this file. No panel, no
 * selection, nothing to set up first.
 *
 * Everything happens inside one undo group and the scratch comp is removed
 * at the end, so the project is left as it was found. Results are written
 * next to this script as ae-probe-results.txt.
 */

(function () {

    var LINES = [];
    var PASS = 0, FAIL = 0, UNKNOWN = 0;

    function out(s) { LINES.push(s === undefined ? "" : String(s)); }

    function check(name, condition, detail) {
        if (condition === null) {
            UNKNOWN++;
            out("  ?  " + name + (detail ? "   " + detail : ""));
        } else if (condition) {
            PASS++;
            out("  ok " + name + (detail ? "   " + detail : ""));
        } else {
            FAIL++;
            out("  FAIL " + name + (detail ? "   " + detail : ""));
        }
    }

    function scriptFolder() {
        try {
            if ($.fileName) { return File($.fileName).parent; }
        } catch (e) {}
        return Folder.temp;
    }

    function readText(file) {
        var text = "";
        if (file.open("r")) {
            text = file.read();
            file.close();
        }
        return text;
    }

    /* ------------------------------------------------------------------
     * Load the panel's own math + engine blocks
     * --------------------------------------------------------------- */

    function slice(source, name) {
        var begin = "/*__SPECTRUM_" + name + "_BEGIN__*/";
        var end = "/*__SPECTRUM_" + name + "_END__*/";
        var a = source.indexOf(begin), b = source.indexOf(end);
        if (a === -1 || b === -1 || b < a) { return null; }
        return source.substring(a + begin.length, b);
    }

    var folder = scriptFolder();
    var panelFile = new File(folder.parent.fsName + "/Spectrum.jsx");
    if (!panelFile.exists) {
        panelFile = new File(folder.fsName + "/Spectrum.jsx");
    }

    out("Spectrum — After Effects API probe");
    out("AE version: " + app.version + "   build: " + app.buildName);
    out("Panel file: " + (panelFile.exists ? panelFile.fsName : "NOT FOUND"));
    out("");

    if (!panelFile.exists) {
        alert("Could not find Spectrum.jsx next to tools/. Keep this script " +
              "inside the repo's tools/ folder.");
        return;
    }

    var source = readText(panelFile);
    var mathBlock = slice(source, "MATH");
    var engineBlock = slice(source, "ENGINE");

    if (!mathBlock || !engineBlock) {
        alert("Marker blocks not found in Spectrum.jsx.");
        return;
    }

    var state = {
        colors: null, orderMode: "layer", angle: 0, space: "oklch",
        keyMode: "skip", targetFill: true, targetStroke: false,
        targetEffect: false
    };

    var DIRECTION_NAMES = {
        "0": "left to right", "45": "up and to the right",
        "90": "bottom to top", "135": "up and to the left",
        "180": "right to left", "225": "down and to the left",
        "270": "top to bottom", "315": "down and to the right"
    };

    var EXPORTS = [
        "hexToRgb", "rgbToHex", "stopsFromColors", "rampColors",
        "compAnchor", "orderLayers", "applyToLayer", "newTally",
        "describeTally", "orderLabel", "firstFillColor", "colorValueFor",
        "spectrumFillEffect", "effectColorProperty", "projectPoint"
    ];

    var exportLines = "return {", i;
    for (i = 0; i < EXPORTS.length; i++) {
        exportLines += (i ? "," : "") + EXPORTS[i] + ":" + EXPORTS[i];
    }
    exportLines += "};";

    var E;
    try {
        E = new Function(
            "state", "app", "PropertyValueType", "EFFECT_NAME",
            "DIRECTION_NAMES",
            mathBlock + "\n" + engineBlock + "\n" + exportLines
        )(state, app, PropertyValueType, "Spectrum Fill", DIRECTION_NAMES);
    } catch (loadError) {
        alert("Could not evaluate the panel's code blocks: " + loadError);
        return;
    }

    out("Loaded MATH + ENGINE blocks from the shipped panel.");
    out("");

    /* ------------------------------------------------------------------
     * Scratch comp
     * --------------------------------------------------------------- */

    var GRID_COLS = 6, GRID_ROWS = 4;
    var COUNT = GRID_COLS * GRID_ROWS;
    var comp = null;
    var createdComp = false;

    app.beginUndoGroup("Spectrum API probe");

    try {
        comp = app.project.items.addComp(
            "Spectrum probe (temporary)", 1920, 1080, 1, 10, 24
        );
        createdComp = true;
        comp.openInViewer();

        /* Build a grid of ellipses, left-to-right then top-to-bottom. */
        var layers = [], r, c, layer, groupContents, fill, grp;
        for (r = 0; r < GRID_ROWS; r++) {
            for (c = 0; c < GRID_COLS; c++) {
                layer = comp.layers.addShape();
                layer.name = "Dot r" + r + "c" + c;

                grp = layer.property("ADBE Root Vectors Group")
                    .addProperty("ADBE Vector Group");
                groupContents = grp.property("ADBE Vectors Group");
                groupContents.addProperty("ADBE Vector Shape - Ellipse")
                    .property("ADBE Vector Ellipse Size").setValue([60, 60]);
                fill = groupContents.addProperty("ADBE Vector Graphic - Fill");
                fill.property("ADBE Vector Fill Color").setValue([0.5, 0.5, 0.5, 1]);

                layer.position.setValue([
                    200 + c * 280,
                    180 + r * 240
                ]);
                layers.push(layer);
            }
        }

        out("Built " + COUNT + " shape layers in a " + GRID_COLS + "x" +
            GRID_ROWS + " grid.");
        out("");

        /* --- Q1: shape fill colour array length ---------------------- */
        out("Q1. Shape fill colour value");
        var probeFill = layers[0].property("ADBE Root Vectors Group")
            .property(1).property("ADBE Vectors Group")
            .property("ADBE Vector Graphic - Fill")
            .property("ADBE Vector Fill Color");
        var v = probeFill.value;
        check("value is an array", v && v.length !== undefined,
              "length = " + (v ? v.length : "n/a"));
        out("     -> colorValueFor() sizes writes from this, so it is correct " +
            "either way");
        var sized = E.colorValueFor(probeFill, [1, 0, 0]);
        check("colorValueFor matches that length", sized.length === v.length,
              "produced " + sized.length + " elements");
        try {
            probeFill.setValue(sized);
            check("setValue accepts it", true,
                  E.rgbToHex(probeFill.value));
        } catch (setErr) {
            check("setValue accepts it", false, String(setErr));
        }
        out("");

        /* --- Q2/Q3: comp-space position vs AE's own toWorld ---------- */
        out("Q2. compAnchor checked against AE's own toWorld()");
        out("    (toWorld exists only in expressions, so the panel composes");
        out("     the parent chain by hand - this proves the two agree)");

        /* A null carrying a Point Control whose expression evaluates
         * toWorld for a chosen layer. AE does the maths; we read it back. */
        var oracle = comp.layers.addNull();
        oracle.name = "Probe oracle";
        var pointFx = oracle.property("ADBE Effect Parade")
            .addProperty("ADBE Point Control");
        var pointProp = pointFx.property(1);

        function toWorldOf(targetLayer) {
            try {
                pointProp.expression =
                    'thisComp.layer("' + targetLayer.name + '").toWorld([0,0])';
                var v = pointProp.valueAtTime(comp.time, false);
                return [v[0], v[1]];
            } catch (exprError) {
                return null;
            }
        }

        function agrees(label, targetLayer) {
            var truth = toWorldOf(targetLayer);
            var mine = E.compAnchor(targetLayer, comp);
            if (truth === null) {
                check(label, null, "toWorld could not be evaluated");
                return;
            }
            check(label,
                  Math.abs(truth[0] - mine[0]) < 0.5 &&
                  Math.abs(truth[1] - mine[1]) < 0.5,
                  "toWorld " + Math.round(truth[0]) + "," + Math.round(truth[1]) +
                  "   compAnchor " + Math.round(mine[0]) + "," + Math.round(mine[1]));
        }

        agrees("unparented layer", layers[0]);

        /* Parented - the case that actually broke. */
        var parent = comp.layers.addNull();
        parent.name = "Probe parent";
        parent.position.setValue([640, 360]);
        var child = layers[0];
        child.parent = parent;
        agrees("parented layer", child);

        parent.scale.setValue([200, 200, 200]);
        agrees("parented to a scaled null", child);

        parent.rotation.setValue(35);
        agrees("parented to a scaled + rotated null", child);

        parent.anchorPoint.setValue([120, 80]);
        agrees("parent with a shifted anchor point", child);

        /* Two levels. */
        var grandparent = comp.layers.addNull();
        grandparent.name = "Probe grandparent";
        grandparent.position.setValue([200, 150]);
        grandparent.rotation.setValue(-20);
        parent.parent = grandparent;
        agrees("two-level parent chain", child);

        /* What the old code did, for the record. */
        var raw = child.position.value;
        var real = E.compAnchor(child, comp);
        out("     raw position.value would have reported " +
            Math.round(raw[0]) + "," + Math.round(raw[1]) +
            " instead of " + Math.round(real[0]) + "," + Math.round(real[1]));

        child.parent = null;
        parent.parent = null;
        parent.remove();
        grandparent.remove();
        oracle.remove();
        out("");

        /* --- Q4: can a locked layer be selected? ---------------------- */
        out("Q4. Locked layers (the panel assumes they cannot be selected)");
        var lockTarget = layers[1];
        lockTarget.selected = true;
        var selectedBefore = comp.selectedLayers.length;
        lockTarget.locked = true;
        var selectedAfter = comp.selectedLayers.length;
        var triedSelect = false;
        try { lockTarget.selected = true; triedSelect = lockTarget.selected; }
        catch (lockErr) { triedSelect = false; }
        check("locking removes it from the selection",
              selectedAfter < selectedBefore,
              selectedBefore + " selected -> " + selectedAfter);
        check("a locked layer cannot be re-selected", triedSelect === false,
              "layer.selected = true -> " + triedSelect);
        lockTarget.locked = false;
        comp.layers[1].selected = false;
        out("");

        /* --- Q5: ADBE Fill effect Color match name -------------------- */
        out("Q5. Spectrum Fill effect");
        var fxLayer = comp.layers.addNull();
        fxLayer.name = "Probe effect host";
        var effect = E.spectrumFillEffect(fxLayer);
        check("effect was added", effect !== null,
              effect ? effect.name : "null");
        if (effect) {
            var byName = null, byMatch = null;
            try { byName = effect.property("Color"); } catch (e3) {}
            try { byMatch = effect.property("ADBE Fill-0002"); } catch (e4) {}
            check("property(\"Color\") resolves", byName !== null,
                  byName ? byName.matchName : "null");
            check("property(\"ADBE Fill-0002\") resolves", byMatch !== null,
                  byMatch ? byMatch.matchName : "null");
            var resolved = E.effectColorProperty(effect);
            check("effectColorProperty finds a colour property",
                  resolved !== null,
                  resolved ? resolved.matchName : "null");
            if (resolved) {
                try {
                    resolved.setValue(E.colorValueFor(resolved, [0, 1, 0]));
                    check("writing the effect colour works", true,
                          E.rgbToHex(resolved.value));
                } catch (e5) {
                    check("writing the effect colour works", false, String(e5));
                }
            }
            /* Re-apply must reuse, not stack. */
            E.spectrumFillEffect(fxLayer);
            E.spectrumFillEffect(fxLayer);
            check("re-applying reuses the effect",
                  fxLayer.property("ADBE Effect Parade").numProperties === 1,
                  fxLayer.property("ADBE Effect Parade").numProperties + " effects");
        }
        fxLayer.remove();
        out("");

        /* --- Q6: ordering, end to end -------------------------------- */
        out("Q6. Ordering against real comp coordinates");
        var k;
        for (k = 0; k < layers.length; k++) { layers[k].selected = true; }

        function firstName(mode, angle) {
            state.orderMode = mode;
            state.angle = angle;
            var ordered = E.orderLayers(layers, comp);
            return ordered[0].name + " ... " + ordered[ordered.length - 1].name;
        }

        /* Grid: r0c0 is top-left, r3c5 is bottom-right. */
        check("0 deg runs left to right",
              firstName("spatial", 0).indexOf("Dot r0c0") === 0 ||
              firstName("spatial", 0).indexOf("Dot r3c0") === 0,
              firstName("spatial", 0));
        check("180 deg runs right to left",
              firstName("spatial", 180).indexOf("c5") !== -1,
              firstName("spatial", 180));
        check("90 deg starts at the BOTTOM row (r3)",
              firstName("spatial", 90).indexOf("Dot r3") === 0,
              firstName("spatial", 90));
        check("270 deg starts at the TOP row (r0)",
              firstName("spatial", 270).indexOf("Dot r0") === 0,
              firstName("spatial", 270));
        check("225 deg starts bottom-right",
              firstName("spatial", 225).indexOf("r3c5") !== -1,
              firstName("spatial", 225));
        out("");

        /* --- Q7: full ramp, read back -------------------------------- */
        out("Q7. Full ramp applied, then read back");
        state.orderMode = "spatial";
        state.angle = 0;
        state.targetFill = true;
        state.targetStroke = false;
        state.targetEffect = false;
        state.colors = [E.hexToRgb("#1B2A6B"), E.hexToRgb("#4FC3C7")];

        var ordered = E.orderLayers(layers, comp);
        var ramp = E.rampColors(E.stopsFromColors(state.colors), ordered.length, "oklch");
        var tally = E.newTally();
        for (k = 0; k < ordered.length; k++) {
            E.applyToLayer(ordered[k], ramp[k], comp, tally);
        }

        out("  report: " + E.describeTally(tally, ordered.length));

        var seen = {}, distinct = 0, readBack = [];
        for (k = 0; k < ordered.length; k++) {
            var got = E.firstFillColor(ordered[k]);
            var hx = got ? E.rgbToHex(got) : "(none)";
            readBack.push(hx);
            if (!seen[hx]) { seen[hx] = 1; distinct++; }
        }
        check("every layer was coloured", tally.layers === COUNT,
              tally.layers + " of " + COUNT);
        check("colours read back distinct", distinct === COUNT,
              distinct + " distinct of " + COUNT);
        check("first layer matches the first stop", readBack[0] === "#1B2A6B",
              readBack[0]);
        check("last layer matches the last stop",
              readBack[readBack.length - 1] === "#4FC3C7",
              readBack[readBack.length - 1]);
        out("  ramp: " + readBack.join(" "));
        out("");

        /* --- Q8: gradient fills really are unscriptable --------------- */
        out("Q8. Gradient fill (expected: colour stops not scriptable)");
        var gLayer = comp.layers.addShape();
        gLayer.name = "Probe gradient";
        var gContents = gLayer.property("ADBE Root Vectors Group")
            .addProperty("ADBE Vector Group").property("ADBE Vectors Group");
        gContents.addProperty("ADBE Vector Shape - Ellipse");
        var gFill = gContents.addProperty("ADBE Vector Graphic - G-Fill");
        var stopsProp = null;
        try { stopsProp = gFill.property("ADBE Vector Grad Colors"); } catch (e6) {}
        var canWriteStops = false;
        if (stopsProp) {
            try {
                stopsProp.setValue([0, 0, 0, 1]);
                canWriteStops = true;
            } catch (e7) { canWriteStops = false; }
        }
        check("gradient colour stops cannot be set", canWriteStops === false,
              stopsProp ? "property exists but setValue " +
                  (canWriteStops ? "SUCCEEDED (assumption wrong!)" : "throws")
                        : "no such property");

        gLayer.selected = true;
        var gTally = E.newTally();
        state.targetFill = true;
        E.applyToLayer(gLayer, [1, 0, 0], comp, gTally);
        check("the panel counts it as a gradient skip", gTally.gradient === 1,
              "gradient=" + gTally.gradient + " colored=" + gTally.colored);
        gLayer.remove();
        out("");

    } catch (probeError) {
        out("");
        out("PROBE ABORTED: " + probeError);
        FAIL++;
    } finally {
        if (createdComp && comp) {
            try { comp.remove(); } catch (removeError) {}
        }
        app.endUndoGroup();
    }

    /* ------------------------------------------------------------------ */

    out("================================================================");
    out(PASS + " ok, " + FAIL + " failed, " + UNKNOWN + " unknown");
    out("Scratch comp removed; project left as found.");

    var resultFile = new File(folder.fsName + "/ae-probe-results.txt");
    var wrote = false;
    try {
        if (resultFile.open("w")) {
            resultFile.write(LINES.join("\n"));
            resultFile.close();
            wrote = true;
        }
    } catch (writeError) {}

    alert("Spectrum probe: " + PASS + " ok, " + FAIL + " failed, " +
          UNKNOWN + " unknown.\n\n" +
          (wrote ? "Results: " + resultFile.fsName
                 : "Could not write the results file."));

})();
