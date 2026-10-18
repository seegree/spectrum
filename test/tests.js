/*
 * Spectrum — unit tests for the pure ramp math.
 *
 * The math lives inside Spectrum.jsx between the /*__SPECTRUM_MATH_BEGIN__* /
 * markers so the panel stays a single installable file. This harness slices
 * that block out and evaluates it standalone, which is why nothing in the
 * block may touch AE globals.
 *
 * Run from the repo root:
 *   node test/run-tests.js
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc test/run-tests-jsc.js
 */

var SPECTRUM_TEST = (function () {

    var passed = 0;
    var failed = 0;
    var messages = [];

    function log(msg) {
        if (typeof console !== "undefined" && console.log) { console.log(msg); }
        else if (typeof print === "function") { print(msg); }
    }

    function ok(name, condition, detail) {
        if (condition) {
            passed++;
        } else {
            failed++;
            messages.push("FAIL  " + name + (detail ? "  — " + detail : ""));
        }
    }

    function near(name, actual, expected, tol) {
        var d = Math.abs(actual - expected);
        ok(name, d <= tol,
            "expected " + expected + " ± " + tol + ", got " + actual);
    }

    function readFileText(path) {
        if (typeof require === "function") {
            return require("fs").readFileSync(path, "utf8");
        }
        if (typeof readFile === "function") { return readFile(path); }
        throw new Error("No file reader available in this runtime.");
    }

    /* --- Load the math block out of Spectrum.jsx --------------------- */

    function loadMath() {
        var source = readFileText("Spectrum.jsx");
        var beginMark = "/*__SPECTRUM_MATH_BEGIN__*/";
        var endMark = "/*__SPECTRUM_MATH_END__*/";
        var a = source.indexOf(beginMark);
        var b = source.indexOf(endMark);

        if (a === -1 || b === -1 || b < a) {
            throw new Error("Math markers not found in Spectrum.jsx");
        }

        var block = source.substring(a + beginMark.length, b);

        /* Export every function the tests need onto one object. */
        var names = [
            "clamp01", "cbrt", "srgbToLinear", "linearToSrgb",
            "rgbToOklab", "oklabToRgbRaw", "oklabToOklch", "oklchToOklab",
            "inGamut", "oklchToRgb", "mixHue", "rgbToHsl", "hslToRgb",
            "interpolate", "stopsFromColors", "sampleStops", "rampColors",
            "addStop", "removeStop", "rgbToHex", "hexToRgb", "integerToRgb",
            "serializeStops", "parseStops", "projectPoint", "normalizeAngle"
        ];

        var exportLines = "return {";
        var i;
        for (i = 0; i < names.length; i++) {
            exportLines += (i ? "," : "") + names[i] + ":" + names[i];
        }
        exportLines += "};";

        return new Function(block + "\n" + exportLines)();
    }

    var M = loadMath();

    /* --- sRGB <-> OKLab round trip ----------------------------------- */

    (function () {
        var cases = [
            [0, 0, 0], [1, 1, 1], [0.5, 0.5, 0.5],
            [1, 0, 0], [0, 1, 0], [0, 0, 1],
            [0.106, 0.165, 0.420], [0.310, 0.765, 0.780],
            [0.949, 0.757, 0.306]
        ];
        var worst = 0, i, c, back;
        for (i = 0; i < cases.length; i++) {
            back = M.oklabToRgbRaw(M.rgbToOklab(cases[i]));
            for (c = 0; c < 3; c++) {
                worst = Math.max(worst, Math.abs(back[c] - cases[i][c]));
            }
        }
        ok("oklab round-trips within 1/255", worst < 1 / 255,
            "worst channel error " + worst);
    })();

    /* --- The muddy middle: the reason OKLab is here ------------------- */

    (function () {
        var blue = [0, 0, 1], yellow = [1, 1, 0];
        var midO = M.interpolate(blue, yellow, 0.5, "oklch");
        var midR = M.interpolate(blue, yellow, 0.5, "rgb");
        var chromaO = M.oklabToOklch(M.rgbToOklab(midO))[1];
        var chromaR = M.oklabToOklch(M.rgbToOklab(midR))[1];

        ok("rgb blue→yellow midpoint is achromatic", chromaR < 0.01,
            "chroma " + chromaR);
        ok("oklch blue→yellow midpoint keeps chroma", chromaO > 0.10,
            "chroma " + chromaO);
        ok("oklch midpoint is far more chromatic than rgb",
            chromaO > chromaR + 0.10,
            "oklch " + chromaO + " vs rgb " + chromaR);
    })();

    /* --- Achromatic endpoints carry the other endpoint's hue ---------- */

    (function () {
        var mid = M.interpolate([1, 1, 1], [1, 0, 0], 0.5, "oklch");
        var midHue = M.oklabToOklch(M.rgbToOklab(mid))[1] > 0.001
            ? M.oklabToOklch(M.rgbToOklab(mid))[2]
            : -1;
        var redHue = M.oklabToOklch(M.rgbToOklab([1, 0, 0]))[2];
        near("white→red midpoint carries red's hue", midHue, redHue, 1.0);

        var grayMid = M.interpolate([1, 1, 1], [0, 0, 0], 0.5, "oklch");
        ok("white→black stays neutral",
            Math.abs(grayMid[0] - grayMid[1]) < 0.005 &&
            Math.abs(grayMid[1] - grayMid[2]) < 0.005,
            M.rgbToHex(grayMid));
    })();

    /* --- Hue takes the shortest arc ---------------------------------- */

    (function () {
        ok("hue wraps forward across 0", Math.abs(M.mixHue(350, 10, 0.2, 0.2, 0.5) - 0) < 1e-6 ||
            Math.abs(M.mixHue(350, 10, 0.2, 0.2, 0.5) - 360) < 1e-6,
            "got " + M.mixHue(350, 10, 0.2, 0.2, 0.5));
        near("hue wraps backward across 0", M.mixHue(10, 350, 0.2, 0.2, 0.5), 0, 1e-6);
        near("hue takes the short way, not the long way",
            M.mixHue(0, 90, 0.2, 0.2, 0.5), 45, 1e-6);
    })();

    /* --- Gamut: every output channel is representable ----------------- */

    (function () {
        var stops = M.stopsFromColors([[0, 0, 1], [0, 1, 0], [1, 0, 0]]);
        var cols = M.rampColors(stops, 64, "oklch");
        var bad = 0, i, c;
        for (i = 0; i < cols.length; i++) {
            for (c = 0; c < 3; c++) {
                if (cols[i][c] < 0 || cols[i][c] > 1) { bad++; }
            }
        }
        ok("no out-of-gamut channels across a wild 3-stop ramp", bad === 0,
            bad + " channels out of range");
    })();

    /* --- Ramp edge cases --------------------------------------------- */

    (function () {
        var two = M.stopsFromColors([[0, 0, 0], [1, 1, 1]]);
        ok("n = 0 returns nothing", M.rampColors(two, 0, "oklch").length === 0);
        ok("n = 1 returns the first stop",
            M.rgbToHex(M.rampColors(two, 1, "oklch")[0]) === "#000000");

        var one = M.stopsFromColors([[0.2, 0.4, 0.6]]);
        var five = M.rampColors(one, 5, "oklch");
        ok("a single stop paints every step the same",
            five.length === 5 &&
            M.rgbToHex(five[0]) === M.rgbToHex(five[4]),
            M.rgbToHex(five[0]) + " vs " + M.rgbToHex(five[4]));

        var zeroWidth = [
            { t: 0, rgb: [1, 0, 0] },
            { t: 0, rgb: [0, 1, 0] },
            { t: 1, rgb: [0, 0, 1] }
        ];
        var got = M.rampColors(zeroWidth, 5, "oklch");
        ok("zero-width segments do not produce NaN",
            isFinite(got[1][0]) && isFinite(got[1][1]) && isFinite(got[1][2]),
            M.rgbToHex(got[1]));
    })();

    /* --- Multi-stop behavior ----------------------------------------- */

    (function () {
        var a = M.hexToRgb("#1B2A6B"), b = M.hexToRgb("#4FC3C7");

        /* Every stop must be reproduced exactly at the step that lands on it. */
        var three = M.addStop([a, b], "oklch");
        var cols = M.rampColors(M.stopsFromColors(three), 5, "oklch");
        ok("a stop is reproduced exactly at its own step",
            M.rgbToHex(cols[0]) === M.rgbToHex(three[0]) &&
            M.rgbToHex(cols[2]) === M.rgbToHex(three[1]) &&
            M.rgbToHex(cols[4]) === M.rgbToHex(three[2]));

        /* The "+ changes nothing" guarantee: 2 -> 3 must be visually exact. */
        var r2 = M.rampColors(M.stopsFromColors([a, b]), 25, "oklch");
        var r3 = M.rampColors(M.stopsFromColors(three), 25, "oklch");
        var worst = 0, i, c;
        for (i = 0; i < 25; i++) {
            for (c = 0; c < 3; c++) {
                worst = Math.max(worst, Math.abs(r2[i][c] - r3[i][c]));
            }
        }
        ok("adding a stop does not move the ramp", worst < 1e-6,
            "worst channel drift " + worst);

        /* + then - round-trips exactly, because - drops the last interior. */
        var back = M.removeStop(three);
        ok("add then remove returns the original stops",
            back.length === 2 &&
            M.rgbToHex(back[0]) === M.rgbToHex(a) &&
            M.rgbToHex(back[1]) === M.rgbToHex(b),
            M.serializeStops(back));

        /* - always keeps the endpoints. */
        var four = M.addStop(three, "oklch");
        var three2 = M.removeStop(four);
        ok("remove keeps both end colors",
            M.rgbToHex(three2[0]) === M.rgbToHex(four[0]) &&
            M.rgbToHex(three2[three2.length - 1]) ===
                M.rgbToHex(four[four.length - 1]));

        /* Reversing the stop list reverses the output. */
        var fwd = M.rampColors(M.stopsFromColors([a, b]), 9, "oklch");
        var rev = M.rampColors(M.stopsFromColors([b, a]), 9, "oklch");
        var mirrored = true;
        for (i = 0; i < 9; i++) {
            if (M.rgbToHex(fwd[i]) !== M.rgbToHex(rev[8 - i])) { mirrored = false; }
        }
        ok("reversing the stops reverses the ramp", mirrored);
    })();

    /* --- Hex and stop-list serialization ------------------------------ */

    (function () {
        ok("hex round-trips", M.rgbToHex(M.hexToRgb("#4FC3C7")) === "#4FC3C7");
        ok("hex accepts no-hash form", M.rgbToHex(M.hexToRgb("4FC3C7")) === "#4FC3C7");
        ok("bad hex is rejected", M.hexToRgb("#12345") === null);
        ok("non-hex is rejected", M.hexToRgb("#ZZZZZZ") === null);

        ok("colorPicker integer decodes as RRGGBB",
            M.rgbToHex(M.integerToRgb(0x4FC3C7)) === "#4FC3C7");

        var stops = M.parseStops("#1B2A6B,#4FC3C7", 2, 8);
        ok("stop list parses", stops !== null && stops.length === 2);
        ok("stop list survives whitespace",
            M.parseStops(" #1B2A6B , #4FC3C7 ", 2, 8) !== null);
        ok("too few stops is rejected", M.parseStops("#1B2A6B", 2, 8) === null);
        ok("too many stops is rejected",
            M.parseStops("#000000,#111111,#222222,#333333,#444444,#555555," +
                "#666666,#777777,#888888", 2, 8) === null);
        ok("garbage is rejected", M.parseStops("not,a,ramp", 2, 8) === null);
        ok("empty is rejected", M.parseStops("", 2, 8) === null);
        ok("round-trips through serialize",
            M.serializeStops(M.parseStops("#1B2A6B,#4FC3C7", 2, 8)) ===
                "#1B2A6B,#4FC3C7");
    })();

    /* --- Spatial projection ------------------------------------------ */

    (function () {
        /* AE screen space: x right, y DOWN. */
        var left = { x: 0, y: 100 }, right = { x: 200, y: 100 };
        var top = { x: 100, y: 0 }, bottom = { x: 100, y: 200 };

        ok("0° puts left before right",
            M.projectPoint(left.x, left.y, 0) < M.projectPoint(right.x, right.y, 0));
        ok("180° puts right before left",
            M.projectPoint(right.x, right.y, 180) <
                M.projectPoint(left.x, left.y, 180));
        ok("90° puts bottom before top (bottom-to-top ramp)",
            M.projectPoint(bottom.x, bottom.y, 90) <
                M.projectPoint(top.x, top.y, 90));
        ok("270° puts top before bottom (top-to-bottom ramp)",
            M.projectPoint(top.x, top.y, 270) <
                M.projectPoint(bottom.x, bottom.y, 270));

        /* 45° = up and to the right: bottom-left first, top-right last. */
        var bottomLeft = M.projectPoint(0, 200, 45);
        var topRight = M.projectPoint(200, 0, 45);
        ok("45° runs bottom-left to top-right", bottomLeft < topRight);

        /* Points on a line perpendicular to the axis tie exactly, so the
         * layer-index tie-break is what keeps ordering stable. */
        near("perpendicular points tie",
            M.projectPoint(0, 0, 90) - M.projectPoint(500, 0, 90), 0, 1e-9);
    })();

    /* --- Angle normalization ----------------------------------------- */

    (function () {
        near("negative angles wrap", M.normalizeAngle(-90), 270, 1e-9);
        near("angles above 360 wrap", M.normalizeAngle(450), 90, 1e-9);
        near("string angles parse", M.normalizeAngle("45"), 45, 1e-9);
        ok("nonsense angle is rejected", M.normalizeAngle("abc") === null);
        /* Number("") is 0, so an empty field would otherwise read as a
         * deliberate 0 degrees instead of "revert to what it was". */
        ok("empty angle is rejected", M.normalizeAngle("") === null);
        ok("whitespace angle is rejected", M.normalizeAngle("   ") === null);
        ok("null angle is rejected", M.normalizeAngle(null) === null);
        ok("infinite angle is rejected", M.normalizeAngle("Infinity") === null);
        near("angle survives surrounding spaces", M.normalizeAngle(" 90 "), 90, 1e-9);
    })();

    /* --- Report ------------------------------------------------------- */

    var i;
    for (i = 0; i < messages.length; i++) { log(messages[i]); }
    log("");
    log(passed + " passed, " + failed + " failed");

    return { passed: passed, failed: failed };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = SPECTRUM_TEST;
}
