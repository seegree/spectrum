/*
 * Spectrum — Node test launcher.
 *
 * Run FROM THE REPO ROOT (paths are cwd-relative):
 *   node test/run-tests.js
 *
 * Exits non-zero when any test fails.
 */

var result = require("./tests.js");

if (!result || result.failed > 0) {
    process.exit(1);
}
