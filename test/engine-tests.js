/*
 * Spectrum — tests for the ordering and writing engine.
 *
 * The engine block in Spectrum.jsx reads After Effects objects but creates
 * none, so it can be sliced out and run against stub layers. This is where
 * the skip accounting lives, and a wrong skip count is the failure mode that
 * would otherwise reach a user as "it silently did nothing to 3 layers".
 *
 * Run from the repo root:
 *   node test/engine-tests.js
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc test/run-engine-jsc.js
 */

var SPECTRUM_ENGINE_TEST = (function () {

    var passed = 0, failed = 0, messages = [];

    function log(msg) {
        if (typeof console !== "undefined" && console.log) { console.log(msg); }
        else if (typeof print === "function") { print(msg); }
    }

    function ok(name, condition, detail) {
        if (condition) { passed++; }
        else {
            failed++;
            messages.push("FAIL  " + name + (detail ? "  — " + detail : ""));
        }
    }

    function readFileText(path) {
        if (typeof require === "function") {
            return require("fs").readFileSync(path, "utf8");
        }
        if (typeof readFile === "function") { return readFile(path); }
        throw new Error("No file reader available in this runtime.");
    }

    function slice(source, name) {
        var begin = "/*__SPECTRUM_" + name + "_BEGIN__*/";
        var end = "/*__SPECTRUM_" + name + "_END__*/";
        var a = source.indexOf(begin), b = source.indexOf(end);
        if (a === -1 || b === -1 || b < a) {
            throw new Error(name + " markers not found in Spectrum.jsx");
        }
        return source.substring(a + begin.length, b);
    }

    /* --- Stubs for the After Effects objects the engine touches ------- */

    function StubProperty(matchName, opts) {
        opts = opts || {};
        this.matchName = matchName;
        this.numProperties = 0;
        this.value = opts.value;
        this.numKeys = opts.numKeys || 0;
        this.expressionEnabled = opts.expressionEnabled || false;
        this.propertyValueType = opts.colorType ? "COLOR_TYPE" : "OTHER";
        this.writes = [];
        this.keyWrites = [];
        this.throwOnSet = opts.throwOnSet || false;
    }
    StubProperty.prototype.setValue = function (v) {
        if (this.throwOnSet) { throw new Error("stub refuses setValue"); }
        if (this.numKeys > 0) { throw new Error("cannot setValue on keyframed"); }
        this.writes.push(v);
        this.value = v;
    };
    StubProperty.prototype.setValueAtTime = function (t, v) {
        this.keyWrites.push([t, v]);
    };
    StubProperty.prototype.property = function () { return null; };

    function StubGroup(matchName, children) {
        this.matchName = matchName;
        this.children = children || [];
        this.numProperties = this.children.length;
        this.named = {};
    }
    /* AE resolves a string key against the property's NAME first — that is
     * how an effect renamed "Spectrum Fill" is found again on re-apply — and
     * falls back to matchName. A stub that only matched matchName made
     * re-apply look like it stacked duplicate effects. */
    StubGroup.prototype.property = function (key) {
        var i;
        if (typeof key === "number") { return this.children[key - 1] || null; }
        if (this.named[key]) { return this.named[key]; }
        for (i = 0; i < this.children.length; i++) {
            if (this.children[i] && this.children[i].name === key) {
                return this.children[i];
            }
        }
        for (i = 0; i < this.children.length; i++) {
            if (this.children[i] && this.children[i].matchName === key) {
                return this.children[i];
            }
        }
        return null;
    };

    /* A transform property as the engine reads it: valueAtTime first,
     * .value as the fallback. */
    function transformProp(value) {
        return {
            value: value,
            valueAtTime: function () { return value; }
        };
    }

    function colorProp(matchName, opts) {
        opts = opts || {};
        opts.colorType = true;
        if (opts.value === undefined) { opts.value = [0, 0, 0, 1]; }
        return new StubProperty(matchName, opts);
    }

    /* A shape layer whose contents hold one Fill and one Stroke. */
    function shapeLayer(index, opts) {
        opts = opts || {};
        var fillColor = colorProp("ADBE Vector Fill Color", opts.fillOpts);
        var strokeColor = colorProp("ADBE Vector Stroke Color", opts.strokeOpts);

        var fill = new StubGroup("ADBE Vector Graphic - Fill", []);
        fill.named["ADBE Vector Fill Color"] = fillColor;

        var stroke = new StubGroup("ADBE Vector Graphic - Stroke", []);
        stroke.named["ADBE Vector Stroke Color"] = strokeColor;

        var inner = [];
        if (!opts.noFill) { inner.push(fill); }
        if (!opts.noStroke) { inner.push(stroke); }
        if (opts.gradientFill) {
            inner.push(new StubGroup("ADBE Vector Graphic - G-Fill", []));
        }

        var contents = new StubGroup("ADBE Vectors Group", inner);
        var group = new StubGroup("ADBE Vector Group", []);
        group.named["ADBE Vectors Group"] = contents;

        var root = new StubGroup("ADBE Root Vectors Group", [group]);

        var layer = {
            index: index,
            name: opts.name || ("Shape " + index),
            fillColor: fillColor,
            strokeColor: strokeColor,
            parent: opts.parent || null,
            position: transformProp(opts.position || [0, 0]),
            anchorPoint: transformProp(opts.anchorPoint || [0, 0]),
            scale: transformProp(opts.scale || [100, 100, 100]),
            rotation: transformProp(
                opts.rotation === undefined ? 0 : opts.rotation
            ),
            property: function (key) {
                if (key === "ADBE Root Vectors Group") { return root; }
                if (key === "ADBE Effect Parade") { return this.effects; }
                return null;
            }
        };

        layer.effects = new StubGroup("ADBE Effect Parade", []);
        layer.effects.canAddProperty = function () { return true; };
        layer.effects.addProperty = function (mn) {
            var eff = new StubGroup(mn, [colorProp("ADBE Fill-0002")]);
            eff.name = "";
            this.children.push(eff);
            this.numProperties = this.children.length;
            return eff;
        };
        return layer;
    }

    /* A layer with no shape contents at all, e.g. a null. */
    function nullLayer(index, position) {
        var effects = new StubGroup("ADBE Effect Parade", []);
        effects.canAddProperty = function () { return true; };
        effects.addProperty = function (mn) {
            var eff = new StubGroup(mn, [colorProp("ADBE Fill-0002")]);
            this.children.push(eff);
            this.numProperties = this.children.length;
            return eff;
        };
        return {
            index: index,
            name: "Null " + index,
            parent: null,
            position: transformProp(position || [0, 0]),
            anchorPoint: transformProp([0, 0]),
            scale: transformProp([100, 100, 100]),
            rotation: transformProp(0),
            effects: effects,
            property: function (key) {
                if (key === "ADBE Effect Parade") { return effects; }
                return null;
            }
        };
    }

    /* --- Load math + engine with the globals they expect --------------- */

    var source = readFileText("Spectrum.jsx");

    var state = {
        colors: null,
        orderMode: "layer",
        angle: 0,
        space: "oklch",
        keyMode: "skip",
        targetFill: true,
        targetStroke: false,
        targetEffect: false
    };

    var undoStack = [];
    var app = {
        beginUndoGroup: function (n) { undoStack.push(n); },
        endUndoGroup: function () { undoStack.pop(); }
    };

    var PropertyValueType = { COLOR: "COLOR_TYPE" };

    var DIRECTION_NAMES = {
        "0": "left to right", "45": "up and to the right",
        "90": "bottom to top", "135": "up and to the left",
        "180": "right to left", "225": "down and to the left",
        "270": "top to bottom", "315": "down and to the right"
    };

    var exports = [
        "orderLayers", "compAnchor", "applyToLayer", "newTally",
        "describeTally", "orderLabel", "writeColor", "paintShapeLayer",
        "firstFillColor", "spectrumFillEffect", "effectColorProperty",
        "colorValueFor", "stopsFromColors", "rampColors", "rgbToHex",
        "hexToRgb"
    ];

    var exportLines = "return {", i;
    for (i = 0; i < exports.length; i++) {
        exportLines += (i ? "," : "") + exports[i] + ":" + exports[i];
    }
    exportLines += "};";

    var E = new Function(
        "state", "app", "PropertyValueType", "EFFECT_NAME", "DIRECTION_NAMES",
        slice(source, "MATH") + "\n" + slice(source, "ENGINE") + "\n" + exportLines
    )(state, app, PropertyValueType, "Spectrum Fill", DIRECTION_NAMES);

    var comp = { time: 1.5 };

    function reset() {
        state.orderMode = "layer";
        state.angle = 0;
        state.space = "oklch";
        state.keyMode = "skip";
        state.targetFill = true;
        state.targetStroke = false;
        state.targetEffect = false;
    }

    /* --- Ordering ------------------------------------------------------ */

    (function () {
        reset();
        var a = shapeLayer(3, { position: [10, 100] });
        var b = shapeLayer(1, { position: [300, 100] });
        var c = shapeLayer(2, { position: [150, 100] });

        var byLayer = E.orderLayers([a, b, c], comp);
        ok("layer order sorts by timeline index",
            byLayer[0].index === 1 && byLayer[1].index === 2 && byLayer[2].index === 3,
            byLayer[0].index + "," + byLayer[1].index + "," + byLayer[2].index);

        state.orderMode = "spatial";
        state.angle = 0;
        var byX = E.orderLayers([a, b, c], comp);
        ok("0° sorts left to right",
            byX[0].position.value[0] === 10 &&
            byX[1].position.value[0] === 150 &&
            byX[2].position.value[0] === 300);

        state.angle = 180;
        var byXrev = E.orderLayers([a, b, c], comp);
        ok("180° sorts right to left",
            byXrev[0].position.value[0] === 300 &&
            byXrev[2].position.value[0] === 10);
    })();

    (function () {
        reset();
        state.orderMode = "spatial";
        state.angle = 90;

        var low = shapeLayer(1, { position: [100, 400] });   /* bottom of frame */
        var high = shapeLayer(2, { position: [100, 50] });   /* top of frame */
        var out = E.orderLayers([high, low], comp);

        ok("90° ramps bottom to top despite AE's Y-down axis",
            out[0].position.value[1] === 400 && out[1].position.value[1] === 50,
            out[0].position.value[1] + " then " + out[1].position.value[1]);
    })();

    (function () {
        reset();
        state.orderMode = "spatial";
        state.angle = 0;

        /* Perfectly stacked layers project identically; the tie-break must
         * keep them in timeline order rather than shuffling. */
        var p = shapeLayer(5, { position: [100, 100] });
        var q = shapeLayer(2, { position: [100, 100] });
        var r = shapeLayer(9, { position: [100, 100] });
        var out = E.orderLayers([p, q, r], comp);

        ok("identical positions tie-break by layer index",
            out[0].index === 2 && out[1].index === 5 && out[2].index === 9,
            out[0].index + "," + out[1].index + "," + out[2].index);
    })();

    /* --- Writing fills and strokes ------------------------------------- */

    (function () {
        reset();
        var layer = shapeLayer(1);
        var tally = E.newTally();
        E.applyToLayer(layer, [1, 0, 0], comp, tally);

        ok("fill is written", layer.fillColor.writes.length === 1);
        ok("stroke is untouched when unchecked", layer.strokeColor.writes.length === 0);
        ok("layer counted once", tally.layers === 1);
        ok("nothing reported as skipped", tally.empty === 0 && tally.gradient === 0);

        ok("existing alpha is preserved",
            layer.fillColor.writes[0].length === 4 &&
            layer.fillColor.writes[0][3] === 1,
            "wrote " + layer.fillColor.writes[0]);
    })();

    (function () {
        reset();
        state.targetStroke = true;
        var layer = shapeLayer(1);
        var tally = E.newTally();
        E.applyToLayer(layer, [0, 1, 0], comp, tally);

        ok("fill and stroke both written",
            layer.fillColor.writes.length === 1 &&
            layer.strokeColor.writes.length === 1);
        ok("two properties, one layer",
            tally.colored === 2 && tally.layers === 1,
            tally.colored + " props / " + tally.layers + " layers");
    })();

    /* A 3-element property must not be handed a 4-element array. */
    (function () {
        reset();
        var layer = shapeLayer(1, { fillOpts: { value: [0, 0, 0] } });
        var tally = E.newTally();
        E.applyToLayer(layer, [0.2, 0.4, 0.6], comp, tally);
        ok("value array length matches the property",
            layer.fillColor.writes[0].length === 3,
            "wrote " + layer.fillColor.writes[0].length + " elements");
    })();

    /* --- Skip accounting ----------------------------------------------- */

    (function () {
        reset();
        var layer = shapeLayer(1, { fillOpts: { expressionEnabled: true } });
        var tally = E.newTally();
        E.applyToLayer(layer, [1, 0, 0], comp, tally);

        ok("expression-driven fill is not written",
            layer.fillColor.writes.length === 0);
        ok("expression-driven fill is counted", tally.expression === 1);
        ok("expression-driven layer is not counted as colored", tally.layers === 0);
    })();

    (function () {
        reset();
        var layer = shapeLayer(1, { fillOpts: { numKeys: 3 } });
        var tally = E.newTally();
        E.applyToLayer(layer, [1, 0, 0], comp, tally);

        ok("animated fill is skipped by default", tally.animated === 1);
        ok("animated fill is not written", layer.fillColor.writes.length === 0);

        reset();
        state.keyMode = "key";
        var layer2 = shapeLayer(1, { fillOpts: { numKeys: 3 } });
        var tally2 = E.newTally();
        E.applyToLayer(layer2, [1, 0, 0], comp, tally2);

        ok("animated fill is keyframed when asked", tally2.keyframed === 1);
        ok("keyframe lands at the comp's current time",
            layer2.fillColor.keyWrites.length === 1 &&
            layer2.fillColor.keyWrites[0][0] === 1.5,
            "t = " + (layer2.fillColor.keyWrites[0] || [])[0]);
        ok("keyframed layer counts as colored", tally2.layers === 1);
    })();

    (function () {
        reset();
        var layer = shapeLayer(1, { gradientFill: true });
        var tally = E.newTally();
        E.applyToLayer(layer, [1, 0, 0], comp, tally);
        ok("gradient fill is counted, not written", tally.gradient === 1);

        /* A gradient stroke must not be counted when only fills are targeted. */
        reset();
        var layer2 = shapeLayer(1, { gradientFill: true });
        state.targetFill = false;
        state.targetStroke = true;
        var tally2 = E.newTally();
        E.applyToLayer(layer2, [1, 0, 0], comp, tally2);
        ok("gradient fill is ignored when only strokes are targeted",
            tally2.gradient === 0, "counted " + tally2.gradient);
    })();

    (function () {
        reset();
        var layer = nullLayer(1);
        var tally = E.newTally();
        E.applyToLayer(layer, [1, 0, 0], comp, tally);
        ok("a layer with no contents is counted as empty", tally.empty === 1);
        ok("a layer with no contents is not counted as colored", tally.layers === 0);
    })();

    (function () {
        reset();
        /* Only Fill checked, but the layer has strokes only. */
        var layer = shapeLayer(1, { noFill: true });
        var tally = E.newTally();
        E.applyToLayer(layer, [1, 0, 0], comp, tally);
        ok("a shape with no matching target is counted as empty",
            tally.empty === 1 && tally.layers === 0);
    })();

    /* --- Fill effect ---------------------------------------------------- */

    (function () {
        reset();
        state.targetFill = false;
        state.targetEffect = true;

        var layer = nullLayer(1);
        var tally = E.newTally();
        E.applyToLayer(layer, [0.1, 0.2, 0.3], comp, tally);

        ok("fill effect is added to a layer with no contents", tally.layers === 1);
        ok("exactly one effect exists", layer.effects.children.length === 1);
        ok("the effect is named Spectrum Fill",
            layer.effects.children[0].name === "Spectrum Fill",
            layer.effects.children[0].name);

        /* Re-applying must reuse it, never stack a second. */
        E.applyToLayer(layer, [0.4, 0.5, 0.6], comp, E.newTally());
        E.applyToLayer(layer, [0.7, 0.8, 0.9], comp, E.newTally());
        ok("re-applying reuses the effect instead of stacking",
            layer.effects.children.length === 1,
            layer.effects.children.length + " effects after 3 applies");
    })();

    /* The Color sub-property is found even when the match name is unknown. */
    (function () {
        reset();
        var eff = new StubGroup("ADBE Fill", [
            new StubProperty("ADBE Fill-0001"),
            colorProp("ADBE Fill-9999")
        ]);
        var found = E.effectColorProperty(eff);
        ok("color property is found by type when the match name is unknown",
            found !== null && found.matchName === "ADBE Fill-9999",
            found ? found.matchName : "null");
    })();

    /* --- Eyedropper ------------------------------------------------------ */

    (function () {
        reset();
        var layer = shapeLayer(1, { fillOpts: { value: [0.2, 0.4, 0.6, 1] } });
        var got = E.firstFillColor(layer);
        ok("eyedropper reads the first fill",
            got !== null && Math.abs(got[0] - 0.2) < 1e-9 &&
            Math.abs(got[2] - 0.6) < 1e-9,
            got ? E.rgbToHex(got) : "null");

        ok("eyedropper returns null when there is no fill",
            E.firstFillColor(nullLayer(2)) === null);
    })();

    /* --- The report ------------------------------------------------------ */

    (function () {
        reset();
        var tally = E.newTally();
        tally.layers = 22;
        tally.colored = 22;
        tally.gradient = 1;
        tally.animated = 2;

        var msg = E.describeTally(tally, 25);
        ok("report leads with layers coloured of layers selected",
            msg.indexOf("Colored 22 layers of 25") === 0, msg);
        ok("report names the gradient skip", msg.indexOf("1 gradient") !== -1, msg);
        ok("report names the animated skip", msg.indexOf("2 animated") !== -1, msg);
        ok("report names the target", msg.indexOf("fills") !== -1, msg);
        ok("report names the order", msg.indexOf("layer order") !== -1, msg);

        /* Nothing skipped means no skip sentence at all. */
        var clean = E.newTally();
        clean.layers = 25;
        clean.colored = 25;
        ok("a clean run says nothing about skips",
            E.describeTally(clean, 25).indexOf("Skipped") === -1,
            E.describeTally(clean, 25));

        /* Singular wording. */
        var one = E.newTally();
        one.layers = 1;
        one.colored = 1;
        ok("one layer reads as singular",
            E.describeTally(one, 1).indexOf("Colored 1 layer of 1") === 0,
            E.describeTally(one, 1));
    })();

    (function () {
        reset();
        state.orderMode = "spatial";
        state.angle = 90;
        ok("order label names the direction",
            E.orderLabel() === "bottom to top", E.orderLabel());

        state.angle = 37;
        ok("an off-tile angle reads in degrees",
            E.orderLabel().indexOf("37") !== -1, E.orderLabel());
    })();

    /* --- Parenting: the case that broke in After Effects ------------- */

    (function () {
        reset();

        /* Unparented: comp position is just the layer position. */
        var plain = shapeLayer(1, { position: [300, 200] });
        var at = E.compAnchor(plain, comp);
        ok("unparented layer sits at its own position",
            at[0] === 300 && at[1] === 200, at.join(","));

        /* Parented: layer.position is measured in the PARENT's space, so
         * the comp position is the sum. Reading position raw — which the
         * old code fell back to — would report 40,30 and sort wrong. */
        var parent = nullLayer(9, [500, 400]);
        var child = shapeLayer(2, { position: [40, 30], parent: parent });
        at = E.compAnchor(child, comp);
        ok("parented layer resolves to comp space",
            at[0] === 540 && at[1] === 430,
            at.join(",") + " (raw position would be 40,30)");

        /* Two levels up. */
        var grandparent = nullLayer(8, [1000, 1000]);
        parent.parent = grandparent;
        at = E.compAnchor(child, comp);
        ok("a two-level parent chain composes",
            at[0] === 1540 && at[1] === 1430, at.join(","));
        parent.parent = null;
    })();

    (function () {
        reset();
        /* A parent scaled 200% doubles the child's offset. */
        var parent = nullLayer(9, [100, 100]);
        parent.scale = transformProp([200, 200, 200]);
        var child = shapeLayer(2, { position: [50, 25], parent: parent });
        var at = E.compAnchor(child, comp);
        ok("a scaled parent scales the child's offset",
            at[0] === 200 && at[1] === 150, at.join(","));
    })();

    (function () {
        reset();
        /* A parent rotated 90 degrees sends +x to +y on screen. */
        var parent = nullLayer(9, [0, 0]);
        parent.rotation = transformProp(90);
        var child = shapeLayer(2, { position: [100, 0], parent: parent });
        var at = E.compAnchor(child, comp);
        ok("a rotated parent rotates the child's offset",
            Math.abs(at[0] - 0) < 1e-9 && Math.abs(at[1] - 100) < 1e-9,
            at.join(","));
    })();

    (function () {
        reset();
        /* A parent's anchor point offsets its children's space. */
        var parent = nullLayer(9, [100, 100]);
        parent.anchorPoint = transformProp([50, 50]);
        var child = shapeLayer(2, { position: [50, 50], parent: parent });
        var at = E.compAnchor(child, comp);
        ok("a parent's anchor point shifts its children",
            at[0] === 100 && at[1] === 100, at.join(","));
    })();

    (function () {
        reset();
        state.orderMode = "spatial";
        state.angle = 0;

        /* The real regression: three layers whose raw positions sort one
         * way and whose comp positions sort the opposite way. */
        var farRight = nullLayer(7, [900, 0]);
        var a = shapeLayer(1, { position: [10, 0], parent: farRight });  /* comp 910 */
        var b = shapeLayer(2, { position: [500, 0] });                   /* comp 500 */
        var c = shapeLayer(3, { position: [100, 0] });                   /* comp 100 */

        var out = E.orderLayers([a, b, c], comp);
        ok("0 deg sorts by comp position, not raw position",
            out[0].index === 3 && out[1].index === 2 && out[2].index === 1,
            "got " + out[0].index + "," + out[1].index + "," + out[2].index +
            " (raw position would give 1,3,2)");
    })();

    (function () {
        reset();
        /* A cycle cannot happen in AE, but never loop on project data
         * without a bound. */
        var x = nullLayer(1, [10, 10]);
        var y = nullLayer(2, [20, 20]);
        x.parent = y;
        y.parent = x;
        var finished = false;
        var at = E.compAnchor(x, comp);
        finished = true;
        ok("a parent cycle terminates instead of hanging",
            finished && isFinite(at[0]) && isFinite(at[1]), at.join(","));
    })();

    /* --- Report ---------------------------------------------------------- */

    for (i = 0; i < messages.length; i++) { log(messages[i]); }
    log("");
    log(passed + " passed, " + failed + " failed");

    return { passed: passed, failed: failed };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = SPECTRUM_ENGINE_TEST;
}
