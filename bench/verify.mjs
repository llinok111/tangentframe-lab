#!/usr/bin/env node
// bench/verify.mjs — 18 numbered assertions with the measured value printed on each line.
import { readFileSync } from "node:fs";
import {
  TOL, detectDefects, repairFrames, frameErrors, oracleTangentError, summarize,
} from "../src/core.mjs";
import { naiveNormalize } from "../baseline/naive.mjs";

const load = (n) => JSON.parse(readFileSync(new URL("../data/" + n, import.meta.url)));
const mesh = load("mesh.json");
const clean = load("clean.json");
const expected = load("expected.json");

let passed = 0, failed = 0;
function check(id, name, ok, detail) {
  const status = ok ? "PASS" : "FAIL";
  if (ok) passed++; else failed++;
  console.log(`${id} ${name}: ${detail} ${status}`);
}

const cleanDefects = detectDefects(clean);
const defects = detectDefects(mesh);
const summary = summarize(defects);
const repaired = repairFrames(mesh);
const after = detectDefects(repaired);
const errBefore = frameErrors(mesh);
const errAfter = frameErrors(repaired);
const naive = naiveNormalize(mesh);
const naiveErr = frameErrors(naive);

// A1: a clean analytic mesh must produce no findings (false-positive control).
check("A1", "clean-false-positives", cleanDefects.length === 0 && clean.normals.length === 2080,
  `${cleanDefects.length}/${clean.normals.length} verts, ${clean.indices.length} tris`);

// A2: exact total of injected findings (42 vertex + 1 triangle).
check("A2", "injected-total", defects.length === 43, `${defects.length} findings (expected 43)`);

// A3: the per-vertex kind multiset equals the generator's ledger.
const kindError = (kind, fn) => Math.max(...expected.injected.filter((d) => d.kind === kind)
  .map((d) => fn(mesh.normals[d.vertex], mesh.tangents[d.vertex])));
const unitErr = (n) => Math.abs(Math.hypot(n[0], n[1], n[2]) - 1);
const tanErr = (n, t) => Math.abs(Math.hypot(t[0], t[1], t[2]) - 1);
const orthoErr = (n, t) => Math.abs(n[0] * t[0] + n[1] * t[1] + n[2] * t[2]);
const unitErrMax = (k) => kindError(k, (n) => unitErr(n));
const tanErrMax = (k) => kindError(k, (n, t) => tanErr(n, t));
const orthoErrMax = (k) => kindError(k, (n, t) => orthoErr(n, t));

const norm = (list) => list.map((d) => `${d.vertex}:${d.kind}`).sort();
const gotKeys = norm(defects.filter((d) => d.kind !== "degenerate-triangle"));
const wantKeys = norm(expected.injected.filter((d) => d.kind !== "degenerate-triangle"));
check("A3", "per-vertex-kind-match", JSON.stringify(gotKeys) === JSON.stringify(wantKeys),
  `${gotKeys.length}/${wantKeys.length} (vertex:kind) pairs identical`);

// A4: exactly one kind per injected vertex (no cascade double-labelling).
const perVertex = new Map();
for (const d of defects) if (d.kind !== "degenerate-triangle") perVertex.set(d.vertex, (perVertex.get(d.vertex) || 0) + 1);
check("A4", "one-kind-per-vertex", [...perVertex.values()].every((v) => v === 1) && perVertex.size === 42,
  `${perVertex.size} vertices, max kinds/vertex = ${Math.max(...perVertex.values())}`);

// A5: every defect class is actually exercised by the corpus.
const wantKinds = expected.injected.reduce((m, d) => (m[d.kind] = (m[d.kind] || 0) + 1, m), {});
const kindMatch = Object.entries(wantKinds).every(([k, n]) => summary.byKind[k] === n);
check("A5", "class-coverage", kindMatch, Object.entries(summary.byKind).map(([k, n]) => `${k}=${n}`).join(" "));

// A6-A8: the defects are real, not cosmetic — measured on the injected class itself,
// so zero-length defects cannot dominate the magnitude by accident.
check("A6", "unnormalized-normal-magnitude", unitErrMax("unnormalized-normal") > 0.69,
  `max |1-|n|| = ${unitErrMax("unnormalized-normal").toFixed(6)} on the 1.7x group (global max incl. zeros = ${errBefore.maxUnit.toFixed(3)})`);
check("A7", "non-orthogonal-magnitude", orthoErrMax("non-orthogonal") > 0.32,
  `max |n·t| = ${orthoErrMax("non-orthogonal").toFixed(6)} (injected +0.35n)`);
check("A8", "unnormalized-tangent-magnitude", tanErrMax("unnormalized-tangent") > 0.59,
  `max |1-|t|| = ${tanErrMax("unnormalized-tangent").toFixed(6)} on the 1.6x group (global max incl. zeros = ${errBefore.maxTangentUnit.toFixed(3)})`);

// A9: after repair only the geometry defect survives (frame repair does not touch geometry).
check("A9", "repair-residual", after.length === 1 && after[0].kind === "degenerate-triangle",
  `residual = ${after.map((d) => d.kind).join(",") || "none"}`);

// A10-A12: repaired frame exactness against an absolute 1e-12 bound.
check("A10", "repaired-normal-unit", errAfter.maxUnit <= 1e-12, `max |1-|n|| = ${errAfter.maxUnit.toExponential(2)}`);
check("A11", "repaired-orthogonality", errAfter.maxOrtho <= 1e-12, `max |n·t| = ${errAfter.maxOrtho.toExponential(2)}`);
check("A12", "repaired-tangent-unit", errAfter.maxTangentUnit <= 1e-12, `max |1-|t|| = ${errAfter.maxTangentUnit.toExponential(2)}`);

// A13: independent cross-product oracle (different code path, own tolerance).
let oracleSin = 0, oracleDot = 1;
for (let i = 0; i < repaired.normals.length; i++) {
  const e = oracleTangentError(repaired.normals[i], repaired.tangents[i]);
  oracleSin = Math.max(oracleSin, e.sin);
  oracleDot = Math.min(oracleDot, e.dot);
}
check("A13", "independent-oracle", oracleSin <= 1e-12 && oracleDot > 0,
  `max sin(angle) = ${oracleSin.toExponential(2)}, min dot = ${oracleDot.toFixed(15)}`);

// A14: idempotency — a second repair is numerically a no-op.
const twice = repairFrames(repaired);
let idem = 0;
for (let i = 0; i < repaired.normals.length; i++) {
  for (let k = 0; k < 3; k++) {
    idem = Math.max(idem, Math.abs(twice.normals[i][k] - repaired.normals[i][k]));
    idem = Math.max(idem, Math.abs(twice.tangents[i][k] - repaired.tangents[i][k]));
  }
  idem = Math.max(idem, Math.abs(twice.tangents[i][3] - repaired.tangents[i][3]));
}
check("A14", "idempotent", idem <= 1e-15, `max component delta on 2nd repair = ${idem.toExponential(2)}`);

// A15: scale invariance across 1e-6 .. 1e6 (positions only; frame results must not change).
const scales = [-20, -10, 0, 10, 20];
let scaleOk = true, scaleDetail = [];
for (const k of scales) {
  const f = Math.pow(2, k);
  const scaled = { ...mesh, positions: mesh.positions.map((p) => [p[0] * f, p[1] * f, p[2] * f]) };
  const d = detectDefects(scaled);
  const r = repairFrames(scaled);
  const e = frameErrors(r);
  const sameKinds = JSON.stringify(summarize(d).byKind) === JSON.stringify(summary.byKind);
  const ok = sameKinds && d.length === 43 && e.maxUnit <= 1e-12 && e.maxOrtho <= 1e-12;
  if (!ok) scaleOk = false;
  scaleDetail.push(`2^${k}:${d.length}/${ok ? "ok" : "bad"}`);
}
check("A15", "scale-invariance", scaleOk, scaleDetail.join(" "));

// A16: handedness is snapped to a valid ±1 sign on every vertex.
const badW = repaired.tangents.filter((t) => t[3] !== 1 && t[3] !== -1).length;
check("A16", "handedness-sign", badW === 0, `${badW}/${repaired.tangents.length} non-±1`);

// A17: geometry is byte-identical before/after frame repair (no silent vertex edits).
const geomSame = JSON.stringify([mesh.positions, mesh.indices]) === JSON.stringify([repaired.positions, repaired.indices]);
check("A17", "geometry-untouched", geomSame, "positions + indices identical");

// A18: the naive baseline (normalize only) leaves the orthogonality defects unfixed.
const naiveResidual = detectDefects(naive).filter((d) => d.kind === "non-orthogonal").length;
check("A18", "naive-fails-orthogonality", naiveResidual >= 10 && naiveErr.maxOrtho > 0.32,
  `${naiveResidual} non-orthogonal survive (10 injected + fallback-generated), max |n·t| = ${naiveErr.maxOrtho.toFixed(6)}`);

console.log(`\n${passed} passed, ${failed} failed, TOL=${TOL}`);
process.exit(failed === 0 ? 0 : 1);