# tangentframe-lab

**glTF tangent-frame doctor**: 42/42 injected vertex frame defects are found and fixed to
`max |n·t| = 1.11e-16` on 2,080 frames (`0/3,968` clean triangles flagged), while the obvious
baseline — just normalizing each vector — still leaves **15 non-orthogonal frames** with
`max |n·t| = 0.9796`. The repair costs **5.70×** the normalize-only pass (measured, disclosed).

Upstream: none

A glTF mesh can carry a `NORMAL` and a `TANGENT` (vec4, `w` = bitangent sign) per vertex.
Shaders that consume them assume an orthonormal frame: `|n| = |t| = 1`, `n·t = 0`, `|w| = 1`.
Broken exporters, hand-edited buffers, and naive "normalize it" fixes violate that assumption
silently — normal mapping then bends light in the wrong direction, and nothing in the file says so.

This tool triages 8 classes of frame defect per vertex plus degenerate triangles, then rebuilds
the frame with Gram–Schmidt, leaving positions and indices byte-identical. It also tells you what
it did *not* fix: geometry defects such as degenerate triangles are still reported after repair.

## Run it

```bash
node tools/gen-sample.mjs && node bench/verify.mjs
```

Open the viewer over a static server (no build step, three.js is pinned via importmap):

```bash
python3 -m http.server 4173
# http://localhost:4173
```

The page runs the **same `src/core.mjs`** as node: the HUD numbers are produced by the core in the
browser, not re-implemented in the renderer. Drag to orbit, wheel to zoom; red = defect vertex.

## Evidence (`bench/result.json`, `node bench/bench.mjs`)

| Claim | Measured | Baseline / control |
| --- | --- | --- |
| injected defects found | 43/43 (42 vertex + 1 triangle) | clean mesh: 0/2,080 vertices, 0/3,968 triangles |
| per-vertex kind classification | 42/42 `(vertex, kind)` pairs identical to generator ledger | one kind per vertex, no cascade labels |
| repaired normal unit error | 2.22e-16 | naive normalize: 0 (it does fix this) |
| repaired orthogonality `max \|n·t\|` | 1.11e-16 | naive normalize: **0.9796, 15 frames still broken** |
| independent oracle (cross-product rebuild, own code path) | max `sin(angle)` 2.24e-16, min dot 0.9999999999999998 | oracle uses plain `sqrt`, no shared constant |
| idempotency | 2nd repair changes components by ≤ 2.22e-16 | — |
| scale invariance | identical 43 findings and ≤1e-12 frame error at 2^-20 … 2^20 | positions scaled, frames unitless |
| geometry untouched | positions + indices identical | — |
| timing (1.04M vertex frames / batch) | cold 7.08 ms, median 6.63 ms/pass, p95 6.65, RSD 0.28% | naive normalize median 1.16 ms → **5.70× overhead** |

Run `node bench/verify.mjs`: 18 numbered assertions, each printing its measured value, exit 0.

## 本轮创新

This account had no tangent-frame product: `gltf-audit-lab` checks GLB container integrity, not
per-vertex frame semantics. The new thing here is **per-vertex frame defect *typing* with a
post-repair exactness certificate and an independent oracle**: the tool does not just normalize —
it distinguishes `non-orthogonal` from `unnormalized-normal`, proves the repaired frame to 1e-16,
and explicitly reports the geometry defect it refuses to touch. The browser shows the same
numbers the node test asserts, so "what you see is what was verified".

## Known limitations (honest)

- **Frames only.** Degenerate triangles are detected and deliberately *not* repaired; the post-repair
  report still contains exactly that one defect.
- **Absolute tolerances.** `TOL = 1e-6` applies to unit-length frames, which are scale-free by
  definition; it is not a distance tolerance. The inverted-normal test assumes the mesh is
  star-shaped around its centroid, which holds for the sample sphere but not for arbitrary assets.
- **Handedness is preserved, not recomputed.** `w` is snapped to ±1 from its stored sign; if the
  source `w` is wrong, this tool will keep it wrong. Deriving `w` from UV winding is out of scope.
- **Cost.** Gram–Schmidt is 5.70× a normalize-only pass (5.70 measured on this host, 4-core
  headless node 24). It is a correctness tool, not a speed claim.
- **Timing is host-specific.** Absolute milliseconds moved run-to-run on the same host; the
  correctness numbers did not. `bench/result.json` holds the committed run.

## License

MIT © 2026 llinok111. See `LICENSE`.