/*
 * Spectrum — Node launcher for the engine tests.
 *
 * Run FROM THE REPO ROOT (paths are cwd-relative):
 *   node test/run-engine.js
 *
 * Exits non-zero when any test fails.
 */

var result = require("./engine-tests.js");

if (!result || result.failed > 0) {
    process.exit(1);
}
