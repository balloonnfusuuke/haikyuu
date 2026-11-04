import assert from "node:assert/strict";
import test from "node:test";
import { advanceRunners, basesLabel, playKind, type Bases } from "../lib/bases";

const loaded: Bases = { first: true, second: true, third: true };

test("四球は一塁が埋まっているときだけ押し出す", () => {
  const empty = advanceRunners({ first: false, second: true, third: false }, "walk");
  assert.deepEqual(empty.bases, { first: true, second: true, third: false });
  assert.equal(empty.runs, 0);
  const forced = advanceRunners(loaded, "walk");
  assert.equal(forced.runs, 1);
  assert.deepEqual(forced.bases, loaded);
});

test("安打は塁数だけ進め、本塁打は全員を還す", () => {
  const single = advanceRunners({ first: true, second: false, third: true }, "single");
  assert.deepEqual(single.bases, { first: true, second: true, third: false });
  assert.equal(single.runs, 1);
  const doubled = advanceRunners({ first: false, second: true, third: true }, "double");
  assert.equal(doubled.runs, 2);
  assert.deepEqual(doubled.bases, { first: false, second: true, third: false });
  const homer = advanceRunners(loaded, "home_run");
  assert.equal(homer.runs, 4);
  assert.equal(basesLabel(homer.bases), "走者なし");
});

test("アウトでは走者はそのまま", () => {
  const play = advanceRunners({ first: true, second: false, third: false }, "out");
  assert.equal(play.out, true);
  assert.equal(play.runs, 0);
  assert.equal(basesLabel(play.bases), "一塁");
  assert.equal(playKind("in_play", "double"), "double");
  assert.equal(playKind("strikeout_swinging", null), "out");
  assert.equal(playKind("in_play", "out"), "out");
});
