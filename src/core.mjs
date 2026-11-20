/*
 * core.mjs — pure glTF tangent-frame (normal / tangent / handedness) triage & repair.
 * No three.js, no DOM, no I/O. Importable by node and by the browser bundle alike.
 *
 * Frame convention: n is the unit surface normal, t the unit tangent, w the sign of
 * the bitangent (b = w * cross(n, t)). A valid frame is |n|=|t|=1, n·t=0, |w|=1.
 */

export const TOL = 1e-6;          // defect threshold, relative to unit frames
export const ORACLE_TOL = 1e-11;  // independent cross-product oracle tolerance

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const isFiniteVec = (a) =>
  Array.isArray(a) && a.length === 3 &&
  Number.isFinite(a[0]) && Number.isFinite(a[1]) && Number.isFinite(a[2]);

export function normalize(a, fallback = [0, 1, 0]) {
  const l = len(a);
  if (!(l > 1e-300) || !Number.isFinite(l)) return fallback.slice();
  return [a[0] / l, a[1] / l, a[2] / l];
}

export function basisFor(n) {
  // deterministic perpendicular basis; pick the axis least aligned with n
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const ref = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  const t = cross(n, ref);
  return normalize(t, [1, 0, 0]);
}

function meshCentroid(positions) {
  const c = [0, 0, 0];
  for (const p of positions) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  const k = positions.length || 1;
  return [c[0] / k, c[1] / k, c[2] / k];
}

/** Defect triage. Returns one record per (vertex|triangle, kind) finding. */
export function detectDefects(mesh) {
  const { positions, normals, tangents, indices } = mesh;
  const defects = [];
  const centroid = meshCentroid(positions);
  const push = (vertex, kind, value, expected) =>
    defects.push({ vertex, kind, value, expected });

  for (let i = 0; i < normals.length; i++) {
    const n = normals[i];
    const t4 = tangents[i] || [0, 0, 0, 0];
    const t = [t4[0], t4[1], t4[2]];
    if (!isFiniteVec(n) || !isFiniteVec(t)) {
      push(i, "nan", null, "finite components");
      continue;
    }
    const ln = len(n);
    if (ln < 1e-12) { push(i, "zero-normal", ln, "|n| = 1"); continue; }
    if (Math.abs(ln - 1) > TOL) { push(i, "unnormalized-normal", ln, 1); continue; }
    const lt = len(t);
    if (lt < 1e-12) { push(i, "zero-tangent", lt, "|t| = 1"); continue; }
    if (Math.abs(lt - 1) > TOL) { push(i, "unnormalized-tangent", lt, 1); continue; }
    const nt = dot(n, t);
    if (Math.abs(nt) > TOL) { push(i, "non-orthogonal", nt, 0); continue; }
    if (!(Math.abs(t4[3]) > 0.5 && Math.abs(Math.abs(t4[3]) - 1) <= TOL)) {
      push(i, "bad-handedness", t4[3], "w = ±1"); continue;
    }
    const radial = dot(n, sub(positions[i], centroid));
    if (radial < 0) { push(i, "inverted-normal", radial, "outward"); }
  }

  for (let k = 0; k < indices.length; k++) {
    const [a, b, c] = indices[k];
    const p = positions[a], q = positions[b], r = positions[c];
    const area = len(cross(sub(q, p), sub(r, p))) * 0.5;
    if (a === b || b === c || a === c || !(area > 0)) {
      push(k, "degenerate-triangle", area, "> 0");
    }
  }
  return defects;
}

/**
 * Gram-Schmidt frame repair.
 * n is normalized (and re-oriented outward from the mesh centroid if flipped),
 * t is projected onto the plane orthogonal to n, then both are re-normalized.
 * Handedness is snapped to the sign of the stored w (default +1).
 */
export function repairFrames(mesh) {
  const centroid = meshCentroid(mesh.positions);
  const repaired = { ...mesh, normals: [], tangents: [] };
  for (let i = 0; i < mesh.normals.length; i++) {
    const p = mesh.positions[i];
    let n = mesh.normals[i];
    if (!isFiniteVec(n)) n = sub(p, centroid);
    let nn = normalize(n, [0, 1, 0]);
    if (dot(nn, sub(p, centroid)) < 0) nn = mul(nn, -1);
    if (len(nn) < 0.5) nn = [0, 1, 0];

    const t4 = mesh.tangents[i] || [0, 0, 0, 0];
    let t = [t4[0], t4[1], t4[2]];
    if (!isFiniteVec(t)) t = basisFor(nn);
    // remove the normal component, then normalize
    let proj = sub(t, mul(nn, dot(t, nn)));
    if (len(proj) < 1e-9) proj = basisFor(nn);
    const tt = normalize(proj, basisFor(nn));
    // exact-ish re-orthogonalization pass (Gram-Schmidt twice kills drift)
    let tt2 = normalize(sub(tt, mul(nn, dot(tt, nn))), basisFor(nn));
    const w = t4[3] < 0 || Object.is(t4[3], -0) ? -1 : 1;
    repaired.normals.push(nn);
    repaired.tangents.push([tt2[0], tt2[1], tt2[2], w]);
  }
  return repaired;
}

/** Max | |n| - 1 | and max |n·t| over the mesh. */
export function frameErrors(mesh) {
  let maxUnit = 0, maxOrtho = 0, maxTangentUnit = 0;
  for (let i = 0; i < mesh.normals.length; i++) {
    const n = mesh.normals[i];
    const t = mesh.tangents[i];
    if (!isFiniteVec(n) || !isFiniteVec([t[0], t[1], t[2]])) continue;
    maxUnit = Math.max(maxUnit, Math.abs(len(n) - 1));
    maxTangentUnit = Math.max(maxTangentUnit, Math.abs(len([t[0], t[1], t[2]]) - 1));
    maxOrtho = Math.max(maxOrtho, Math.abs(dot(n, [t[0], t[1], t[2]])));
  }
  return { maxUnit, maxTangentUnit, maxOrtho };
}

/**
 * Independent oracle: rebuilds the tangent with two cross products (no shared
 * constant with repairFrames) and reports the angle to the stored tangent.
 * Only valid for finite, non-degenerate frames.
 */
export function oracleTangentError(n, t) {
  // Self-contained double-precision reimplementation: plain sqrt (not hypot),
  // direct component arithmetic, and no constant imported from the repair path.
  const nrm = (v) => {
    const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    return l > 0 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 1, 0];
  };
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nn = nrm(n);
  const tt = nrm([t[0], t[1], t[2]]);
  let rebuilt = nrm(cr(nn, cr(tt, nn)));
  const s = cr(rebuilt, tt);
  return {
    sin: Math.sqrt(s[0] * s[0] + s[1] * s[1] + s[2] * s[2]),
    dot: rebuilt[0] * tt[0] + rebuilt[1] * tt[1] + rebuilt[2] * tt[2],
  };
}

export function summarize(defects) {
  const byKind = {};
  const vertices = new Set(), triangles = new Set();
  for (const d of defects) {
    byKind[d.kind] = (byKind[d.kind] || 0) + 1;
    if (d.kind === "degenerate-triangle") triangles.add(d.vertex);
    else vertices.add(d.vertex);
  }
  return {
    total: defects.length,
    byKind,
    defectVertices: vertices.size,
    defectTriangles: triangles.size,
    cleanVertices: null, // filled by caller with mesh size
  };
}

/** Triangle-level normal consistency check: geometric normal vs stored normals. */
export function maxGeometricDeviation(mesh, repaired) {
  let worst = 0;
  for (const [a, b, c] of mesh.indices) {
    const g = cross(sub(mesh.positions[b], mesh.positions[a]), sub(mesh.positions[c], mesh.positions[a]));
    if (len(g) < 1e-12) continue;
    const gn = normalize(g);
    const avg = normalize(add(add(repaired.normals[a], repaired.normals[b]), repaired.normals[c]), [0, 1, 0]);
    worst = Math.max(worst, Math.acos(Math.min(1, Math.max(-1, dot(gn, avg)))));
  }
  return worst;
}