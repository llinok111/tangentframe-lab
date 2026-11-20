#!/usr/bin/env node
// Deterministic sample generator: a UV-band sphere with analytically exact frames,
// plus a fixed set of injected tangent-frame defects. Same command -> same bytes.
import { writeFileSync, mkdirSync } from "node:fs";

const COLS = 64, ROWS = 32;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildSphere() {
  const positions = [], normals = [], tangents = [], indices = [];
  for (let r = 0; r < ROWS; r++) {
    const v = (r + 0.5) / ROWS;
    const phi = v * Math.PI;
    const sp = Math.sin(phi), cp = Math.cos(phi);
    for (let c = 0; c <= COLS; c++) {
      const u = c / COLS;
      const theta = u * 2 * Math.PI;
      const st = Math.sin(theta), ct = Math.cos(theta);
      positions.push([sp * ct, cp, sp * st]);
      normals.push([sp * ct, cp, sp * st]);
      // dP/du normalised: the tangent is independent of phi, so poles are safe too
      tangents.push([-st, 0, ct, 1]);
    }
  }
  for (let r = 0; r < ROWS - 1; r++) {
    for (let c = 0; c < COLS; c++) {
      const a = r * (COLS + 1) + c, b = a + 1;
      const d = a + (COLS + 1), e = d + 1;
      indices.push([a, d, b], [b, d, e]);
    }
  }
  return { positions, normals, tangents, indices };
}

const clean = buildSphere();
const mesh = JSON.parse(JSON.stringify(clean));
const rand = mulberry32(20261120);
const used = new Set();
function pick() {
  for (;;) {
    const i = 40 + Math.floor(rand() * (clean.normals.length - 80));
    if (!used.has(i)) { used.add(i); return i; }
  }
}

const injected = [];
const add = (kind, n) => {
  for (let k = 0; k < n; k++) injected.push({ vertex: pick(), kind });
};
add("unnormalized-normal", 10);
add("non-orthogonal", 10);
add("zero-tangent", 5);
add("nan", 3);
add("bad-handedness", 5);
add("inverted-normal", 4);
add("zero-normal", 3);
add("unnormalized-tangent", 2);

for (const { vertex, kind } of injected) {
  const n = mesh.normals[vertex], t = mesh.tangents[vertex];
  if (kind === "unnormalized-normal") mesh.normals[vertex] = [n[0] * 1.7, n[1] * 1.7, n[2] * 1.7];
  else if (kind === "non-orthogonal") {
    const d = n[0] * t[0] + n[1] * t[1] + n[2] * t[2];
    const blended = [t[0] + 0.35 * n[0], t[1] + 0.35 * n[1], t[2] + 0.35 * n[2]];
    const l = Math.hypot(...blended);
    mesh.tangents[vertex] = [blended[0] / l, blended[1] / l, blended[2] / l, t[3]];
  } else if (kind === "zero-tangent") mesh.tangents[vertex] = [0, 0, 0, t[3]];
  else if (kind === "nan") mesh.normals[vertex] = [NaN, 0, 0];
  else if (kind === "bad-handedness") mesh.tangents[vertex] = [t[0], t[1], t[2], 0];
  else if (kind === "inverted-normal") mesh.normals[vertex] = [-n[0], -n[1], -n[2]];
  else if (kind === "zero-normal") mesh.normals[vertex] = [0, 0, 0];
  else if (kind === "unnormalized-tangent") mesh.tangents[vertex] = [t[0] * 1.6, t[1] * 1.6, t[2] * 1.6, t[3]];
}

// one injected degenerate triangle (frame repair must NOT claim to fix geometry)
const degenerate = 700;
mesh.indices[degenerate] = [mesh.indices[degenerate][0], mesh.indices[degenerate][0], mesh.indices[degenerate][1]];
injected.push({ vertex: degenerate, kind: "degenerate-triangle" });

injected.sort((a, b) => a.vertex - b.vertex || a.kind.localeCompare(b.kind));
mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
const out = (name, obj) =>
  writeFileSync(new URL("../data/" + name, import.meta.url), JSON.stringify(obj) + "\n");

out("clean.json", { meta: { cols: COLS, rows: ROWS, vertices: clean.normals.length, triangles: clean.indices.length }, ...clean });
out("mesh.json", { meta: { cols: COLS, rows: ROWS, vertices: mesh.normals.length, triangles: mesh.indices.length, seed: 20261120 }, ...mesh });
out("expected.json", { injected, vertexDefects: injected.filter((d) => d.kind !== "degenerate-triangle").length });

console.log(`wrote data/{clean,mesh,expected}.json: ${clean.normals.length} vertices, ${clean.indices.length} triangles, ${injected.length} injected defects`);