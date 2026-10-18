/*
 * Spectrum — parse-only syntax check, plus an ES3 guard.
 *
 * Every file the panel loads in After Effects is compiled with
 * new Function(...) but never executed, so AE-only globals (app, Panel,
 * PropertyValueType, $, ...) do not matter here.
 *
 * Run from the repo root with either runtime:
 *   node test/check-syntax.js
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc test/check-syntax.js
 */

var FILES = [
    "Spectrum.jsx",
    "test/tests.js",
    "test/engine-tests.js"
];

function print_(msg) {
    if (typeof console !== "undefined" && console.log) { console.log(msg); }
    else if (typeof print === "function") { print(msg); }
}

function readFileText(path) {
    /* Node */
    if (typeof require === "function") {
        return require("fs").readFileSync(path, "utf8");
    }
    /* jsc: readFile is a built-in, cwd-relative */
    if (typeof readFile === "function") {
        return readFile(path);
    }
    throw new Error("No file reader available in this runtime.");
}

/* The ES3 patterns below must be matched against CODE, not prose. Comments
 * discussing `angle` in backticks are not template literals, and a comment
 * mentioning "const" is not a declaration. Strip comments and string bodies
 * first, or the guard cries wolf and gets switched off — which is worse than
 * not having it. */
function stripCommentsAndStrings(src) {
    var out = "", i = 0, n = src.length, ch, next, quote;

    while (i < n) {
        ch = src.charAt(i);
        next = i + 1 < n ? src.charAt(i + 1) : "";

        if (ch === "/" && next === "*") {
            i += 2;
            while (i < n && !(src.charAt(i) === "*" && src.charAt(i + 1) === "/")) {
                i++;
            }
            i += 2;
            out += " ";
        } else if (ch === "/" && next === "/") {
            while (i < n && src.charAt(i) !== "\n") { i++; }
        } else if (ch === "\"" || ch === "'") {
            quote = ch;
            i++;
            while (i < n && src.charAt(i) !== quote) {
                if (src.charAt(i) === "\\") { i++; }
                i++;
            }
            i++;
            out += "\"\"";
        } else {
            out += ch;
            i++;
        }
    }
    return out;
}

/* ES5+ constructs that ExtendScript's ES3 engine does not provide.
 * Note: `.indexOf(` cannot be told apart statically from the ES3-legal
 * String.prototype.indexOf, so it is deliberately NOT checked here — a
 * guard that fires on legal code is worse than no guard. */
var ES3_FORBIDDEN = [
    { re: /\bconst\s+[A-Za-z_$]/, name: "const" },
    { re: /\blet\s+[A-Za-z_$]/, name: "let" },
    { re: /=>/, name: "arrow function" },
    { re: /\bJSON\s*\./, name: "JSON" },
    { re: /\.\s*forEach\s*\(/, name: "Array.forEach" },
    { re: /\.\s*map\s*\(/, name: "Array.map" },
    { re: /\.\s*filter\s*\(/, name: "Array.filter" },
    { re: /\.\s*trim\s*\(/, name: "String.trim" },
    { re: /\bObject\s*\.\s*keys\b/, name: "Object.keys" },
    { re: /\bDate\s*\.\s*now\b/, name: "Date.now" },
    { re: /\bMath\s*\.\s*cbrt\b/, name: "Math.cbrt" },
    { re: /`/, name: "template literal" }
];

function hasNulByte(src) {
    var i;
    for (i = 0; i < src.length; i++) {
        if (src.charCodeAt(i) === 0) { return true; }
    }
    return false;
}

var failures = 0;
var i, j, path, source, code;

for (i = 0; i < FILES.length; i++) {
    path = FILES[i];

    try {
        source = readFileText(path);
    } catch (readError) {
        print_("READ FAIL  " + path + " — " + readError);
        failures++;
        continue;
    }

    try {
        /* Compile without running. */
        new Function(source);
        print_("ok         " + path);
    } catch (syntaxError) {
        print_("SYNTAX     " + path + " — " + syntaxError);
        failures++;
        continue;
    }

    /* A literal NUL makes tools treat the source as binary — an editing
     * slip worth catching early (docs/jsx-design-principles.md §2). */
    if (hasNulByte(source)) {
        print_("BINARY     " + path + " contains a NUL byte");
        failures++;
    }
}

/* Panel invariants that are not visible to the unit tests, because they live
 * in the ScriptUI layer. Each one encodes a bug that actually shipped. */
var INVARIANTS = [
    {
        re: /\bapply\s*\.\s*enabled\s*=/,
        name: "Apply must never be disabled",
        why: "After Effects gives a panel no selection-change callback, so " +
             "the cached layer count goes stale. Disabling Apply on a stale " +
             "count deadlocks the panel: a disabled button cannot be clicked, " +
             "so clicking it cannot trigger the refresh that re-enables it. " +
             "Apply re-reads the live selection on click instead."
    }
];

/* The ES3 guard applies only to the panel: the test files run under Node or
 * jsc, which are not ES3. */
try {
    code = stripCommentsAndStrings(readFileText("Spectrum.jsx"));

    for (j = 0; j < ES3_FORBIDDEN.length; j++) {
        if (ES3_FORBIDDEN[j].re.test(code)) {
            print_("ES3        Spectrum.jsx uses " + ES3_FORBIDDEN[j].name);
            failures++;
        }
    }

    for (j = 0; j < INVARIANTS.length; j++) {
        if (INVARIANTS[j].re.test(code)) {
            print_("INVARIANT  " + INVARIANTS[j].name);
            print_("           " + INVARIANTS[j].why);
            failures++;
        }
    }
} catch (es3Error) {
    print_("READ FAIL  Spectrum.jsx — " + es3Error);
    failures++;
}

if (failures > 0) {
    throw new Error("SYNTAX CHECK FAILURES: " + failures);
}

print_("");
print_("All files parse; Spectrum.jsx is ES3-clean.");
