// baseline/naive.mjs — the obvious fix: normalize each normal and tangent in place,
// keep handedness untouched. This is what a "just normalize it" pass does.
export function naiveNormalize(mesh) {
  const normals = [], tangents = [];
  for (let i = 0; i < mesh.normals.length; i++) {
    const n = mesh.normals[i], t = mesh.tangents[i] || [0, 0, 0, 0];
    const ln = Math.hypot(n[0], n[1], n[2]);
    normals.push(ln > 1e-12 && Number.isFinite(ln) ? [n[0] / ln, n[1] / ln, n[2] / ln] : [0, 1, 0]);
    const lt = Math.hypot(t[0], t[1], t[2]);
    tangents.push(lt > 1e-12 && Number.isFinite(lt)
      ? [t[0] / lt, t[1] / lt, t[2] / lt, t[3]]
      : [1, 0, 0, t[3]]);
  }
  return { ...mesh, normals, tangents };
}