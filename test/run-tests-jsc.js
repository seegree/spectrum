/*
 * Spectrum — jsc (JavaScriptCore) test launcher, for machines without Node.
 * macOS ships jsc at:
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
 *
 * Run FROM THE REPO ROOT (load() and readFile() paths are cwd-relative):
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc test/run-tests-jsc.js
 *
 * Exits non-zero (via uncaught exception) when any test fails.
 */

load("test/tests.js");

if (!this.SPECTRUM_TEST || this.SPECTRUM_TEST.failed > 0) {
    throw new Error("TEST FAILURES: " +
        (this.SPECTRUM_TEST ? this.SPECTRUM_TEST.failed : "harness error"));
}
