/*
 * Spectrum — selection diagnostic.
 *
 * Answers the two questions a "it reported success but nothing changed"
 * result cannot answer on its own:
 *   1. Did the fills actually end up different colors?
 *   2. Do the layers occupy distinct comp-space positions, or do they all
 *      project to the same point (which would make spatial ordering a no-op)?
 *
 * Run: File > Scripts > Run Script File… and pick this file, with the
 * layers selected. Writes a report to your Desktop and shows a summary.
 * Read-only — it changes nothing in the project.
 */

(function () {

    function safeProp(parent, name) {
        try { return parent.property(name); } catch (e) { return null; }
    }

    function hex(rgb) {
        var s = "#", i, v;
        if (!rgb) { return "(none)"; }
        for (i = 0; i < 3; i++) {
            v = Math.round(Math.max(0, Math.min(1, rgb[i])) * 255)
                .toString(16).toUpperCase();
            s += v.length === 1 ? "0" + v : v;
        }
        return s;
    }

    /* Collect every fill colour on the layer, plus anything that would
     * render on top of one. */
    function survey(group, found) {
        var i, p, mn, contents, value;
        if (!group) { return; }

        for (i = 1; i <= group.numProperties; i++) {
            p = null;
            try { p = group.property(i); } catch (e) { continue; }
            if (!p) { continue; }

            mn = "";
            try { mn = p.matchName; } catch (e2) { continue; }

            if (mn === "ADBE Vector Group") {
                contents = safeProp(p, "ADBE Vectors Group");
                survey(contents, found);
            } else if (mn === "ADBE Vectors Group") {
                survey(p, found);
            } else if (mn === "ADBE Vector Graphic - Fill") {
                try {
                    value = p.property("ADBE Vector Fill Color").value;
                    found.fills.push(hex(value));
                } catch (e3) { found.fills.push("(unreadable)"); }
            } else if (mn === "ADBE Vector Graphic - G-Fill") {
                found.gradients++;
            } else if (mn === "ADBE Vector Filter - Repeater") {
                found.repeaters++;
            }
        }
    }

    /* Same comp-space maths the panel uses: layer.position is measured in
     * the PARENT's space, so a parented layer must be walked up the chain.
     * Expressions would use toWorld(); scripting has no equivalent. */
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

    function pointToParentSpace(layer, point, t) {
        var anchor = valueAt(layer, "anchorPoint", t, [0, 0, 0]);
        var position = valueAt(layer, "position", t, [0, 0, 0]);
        var scale = valueAt(layer, "scale", t, [100, 100, 100]);
        var rotation = valueAt(layer, "rotation", t, 0);
        var vx = (point[0] - anchor[0]) * (scale[0] / 100);
        var vy = (point[1] - anchor[1]) * (scale[1] / 100);
        var rad = (typeof rotation === "number" ? rotation : 0) * Math.PI / 180;
        var cos = Math.cos(rad), sin = Math.sin(rad);
        return [
            position[0] + vx * cos - vy * sin,
            position[1] + vx * sin + vy * cos
        ];
    }

    function compAnchor(layer, comp) {
        var t = 0, p, parent = null, guard = 0;
        try { t = comp.time; } catch (timeError) { t = 0; }
        p = valueAt(layer, "position", t, [0, 0, 0]);
        try { parent = layer.parent; } catch (parentError) { parent = null; }
        while (parent && guard < 32) {
            p = pointToParentSpace(parent, p, t);
            try { parent = parent.parent; } catch (walkError) { parent = null; }
            guard++;
        }
        return [p[0], p[1]];
    }

    var comp = app.project ? app.project.activeItem : null;
    if (!(comp && comp instanceof CompItem)) {
        alert("Open a composition first.");
        return;
    }

    var sel = comp.selectedLayers;
    if (!sel.length) {
        alert("Select the layers to diagnose first.");
        return;
    }

    var lines = [];
    var uniqueFills = {}, uniqueFillCount = 0;
    var uniquePoints = {}, uniquePointCount = 0;
    var totalRepeaters = 0, totalGradients = 0, totalEffects = 0;
    var parentedCount = 0;
    var i, layer, found, pt, ptKey, anchor, fx, method;

    lines.push("Spectrum diagnostic");
    lines.push("Comp: " + comp.name + "   selected: " + sel.length);
    lines.push("");
    lines.push("idx  name                      position        compAnchor       fills");
    lines.push("---------------------------------------------------------------------");

    for (i = 0; i < sel.length; i++) {
        layer = sel[i];
        found = { fills: [], gradients: 0, repeaters: 0 };

        survey(safeProp(layer, "ADBE Root Vectors Group"), found);
        totalGradients += found.gradients;
        totalRepeaters += found.repeaters;

        fx = safeProp(layer, "ADBE Effect Parade");
        try { if (fx && fx.numProperties > 0) { totalEffects++; } } catch (e) {}

        try { anchor = layer.anchorPoint.value; } catch (e) { anchor = [0, 0]; }

        pt = compAnchor(layer, comp);
        method = (layer.parent ? "parent chain" : "direct");

        try { if (layer.parent) { parentedCount++; } } catch (pe) {}

        ptKey = Math.round(pt[0] * 100) / 100 + "," + Math.round(pt[1] * 100) / 100;
        if (!uniquePoints[ptKey]) { uniquePoints[ptKey] = 1; uniquePointCount++; }

        for (var f = 0; f < found.fills.length; f++) {
            if (!uniqueFills[found.fills[f]]) {
                uniqueFills[found.fills[f]] = 1;
                uniqueFillCount++;
            }
        }

        /* Full detail for the first and last 12; the middle is just noise. */
        if (i < 12 || i >= sel.length - 12) {
            lines.push(
                pad(String(layer.index), 5) +
                pad(layer.name, 26) +
                pad(fmt(layer.position.value), 16) +
                pad(fmt(pt), 17) +
                found.fills.join(" ")
            );
        } else if (i === 12) {
            lines.push("   ... " + (sel.length - 24) + " more ...");
        }
    }

    function fmt(p) {
        if (!p) { return "-"; }
        return Math.round(p[0]) + "," + Math.round(p[1]);
    }
    function pad(s, n) {
        s = String(s);
        while (s.length < n) { s += " "; }
        return s.substring(0, n);
    }

    var verdict = [];
    verdict.push("Layers selected:        " + sel.length);
    verdict.push("Distinct fill colors:   " + uniqueFillCount);
    verdict.push("Distinct comp anchors:  " + uniquePointCount);
    verdict.push("Parented layers:        " + parentedCount);
    verdict.push("Layers with effects:    " + totalEffects);
    verdict.push("Gradient fills found:   " + totalGradients);
    verdict.push("Repeaters found:        " + totalRepeaters);
    verdict.push("");

    if (uniqueFillCount <= 1) {
        verdict.push("=> The fills are all ONE color. The ramp did not reach them,");
        verdict.push("   or something re-wrote them afterwards.");
    } else if (uniqueFillCount < sel.length / 2) {
        verdict.push("=> Fewer distinct colors than layers. Expected roughly one");
        verdict.push("   per layer.");
    } else {
        verdict.push("=> The fills ARE distinct. Whatever you are seeing on screen");
        verdict.push("   is not these fills — look for a Repeater, an effect, or");
        verdict.push("   layers stacked in registration hiding each other.");
    }

    if (uniquePointCount <= 1 && sel.length > 1) {
        verdict.push("");
        verdict.push("=> Every layer projects to the SAME comp point, so the");
        verdict.push("   direction tiles do nothing and order falls back to layer");
        verdict.push("   index. The grid is built inside the layers, not by their");
        verdict.push("   transforms.");
    }

    lines.push("");
    for (i = 0; i < verdict.length; i++) { lines.push(verdict[i]); }

    var file = new File(Folder.desktop.fsName + "/spectrum-diagnostic.txt");
    var wrote = false;
    try {
        if (file.open("w")) {
            file.write(lines.join("\n"));
            file.close();
            wrote = true;
        }
    } catch (writeError) {}

    alert(verdict.join("\n") +
        (wrote ? "\n\nFull report: Desktop/spectrum-diagnostic.txt"
               : "\n\n(Could not write the report file.)"));

})();
