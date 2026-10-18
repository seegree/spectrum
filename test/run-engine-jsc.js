/*
 * Spectrum — jsc launcher for the engine tests.
 *
 * Run FROM THE REPO ROOT:
 *   /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc test/run-engine-jsc.js
 */

load("test/engine-tests.js");

if (!this.SPECTRUM_ENGINE_TEST || this.SPECTRUM_ENGINE_TEST.failed > 0) {
    throw new Error("ENGINE TEST FAILURES: " +
        (this.SPECTRUM_ENGINE_TEST ? this.SPECTRUM_ENGINE_TEST.failed : "harness error"));
}
