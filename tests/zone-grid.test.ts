import assert from "node:assert/strict";
import test from "node:test";
import { cellCenter, cellRect } from "../lib/zone-grid";

test("マスの中心は境界の中央で、上の行ほど高い", () => {
  for (let cell = 0; cell < 25; cell += 1) {
    const rect = cellRect(cell, 1.5, 3.5);
    const [x, z] = cellCenter(cell, 1.5, 3.5);
    assert.ok(Math.abs((rect.x0 + rect.x1) / 2 - x) < 1e-9);
    assert.ok(Math.abs((rect.z0 + rect.z1) / 2 - z) < 1e-9);
    assert.ok(rect.x1 > rect.x0);
    assert.ok(rect.z1 > rect.z0);
  }
  const top = cellRect(0, 1.5, 3.5);
  const bottom = cellRect(20, 1.5, 3.5);
  assert.ok(top.z0 > bottom.z1);
});
