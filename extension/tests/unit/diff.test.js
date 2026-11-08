const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const { wordDiff, detectDirection } = require("../../src/diff.js");

const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../desktop/tests/fixtures/diff_cases.json"), "utf8"));

for (const [i, c] of cases.entries()) {
  test(`shared diff case ${i} matches Python`, () => {
    assert.deepStrictEqual(wordDiff(c.a, c.b).map((o) => [o.op, o.text]), c.ops);
  });
}

test("direction", () => {
  assert.equal(detectDirection("שלום עולם"), "rtl");
  assert.equal(detectDirection("Hello world"), "ltr");
  assert.equal(detectDirection("12345"), "ltr");
  assert.equal(detectDirection('Meeting with ד"ר כהן at 10'), "ltr");
});
