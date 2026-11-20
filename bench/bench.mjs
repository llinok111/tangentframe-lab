#!/usr/bin/env node
// bench/bench.mjs — cold start + 2 warmups + 7 samples, median/p95/stddev/RSD.
// Workload: 500 full passes over the 2,080-vertex mesh (1.04M vertex frames / pass-set).
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { detectDefects, repairFrames, frameErrors } from "../src/core.mjs";
import { naiveNormalize } from "../baseline/naive.mjs";

const mesh = JSON.parse(readFileSync(new URL("../data/mesh.json", import.meta.url)));
const REPEAT = 500;
const SAMPLES = 7;

function pipelinePass(m) {
  const d = detectDefects(m);
  const r = repairFrames(m);
  frameErrors(r);
  return d.length + r.normals.length; // keep the work observable
}
function naivePass(m) {
  const r = naiveNormalize(m);
  frameErrors(r);
  return r.normals.length;
}

function batch(fn) {
  const t0 = performance.now();
  let acc = 0;
  for (let i = 0; i < REPEAT; i++) acc += fn(mesh);
  const total = performance.now() - t0;
  return { total, perPass: total / REPEAT, acc };
}

function stats(xs) {
  const sorted = [...xs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const min = sorted[0];
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)];
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const stddev = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return { min, median, p95, stddev, rsd: stddev / mean };
}

// cold start: very first execution, no warmup
const cold = batch(pipelinePass);
// warmups
batch(pipelinePass); batch(pipelinePass); batch(naivePass); batch(naivePass);

const samples = [], naiveSamples = [];
for (let i = 0; i < SAMPLES; i++) samples.push(batch(pipelinePass).perPass);
for (let i = 0; i < SAMPLES; i++) naiveSamples.push(batch(naivePass).perPass);

const s = stats(samples), ns = stats(naiveSamples);
const repaired = repairFrames(mesh);
const err = frameErrors(repaired);
const result = {
  machine: "node " + process.version + " (4-core / 3.6GB headless)",
  workload: { vertices: mesh.normals.length, triangles: mesh.indices.length, repeat: REPEAT, vertexFramesPerBatch: REPEAT * mesh.normals.length },
  cold_ms_per_pass: +cold.perPass.toFixed(4),
  pipeline: {
    samples_ms: samples.map((x) => +x.toFixed(4)),
    min_ms: +s.min.toFixed(4), median_ms: +s.median.toFixed(4), p95_ms: +s.p95.toFixed(4),
    stddev_ms: +s.stddev.toFixed(4), rsd: +s.rsd.toFixed(4),
    ms_per_1M_vertex_frames: +(s.median / mesh.normals.length * 1e6).toFixed(2),
  },
  baseline_naive_normalize: {
    samples_ms: naiveSamples.map((x) => +x.toFixed(4)),
    min_ms: +ns.min.toFixed(4), median_ms: +ns.median.toFixed(4), p95_ms: +ns.p95.toFixed(4),
    stddev_ms: +ns.stddev.toFixed(4), rsd: +ns.rsd.toFixed(4),
  },
  overhead_vs_naive: +(s.median / ns.median).toFixed(3),
  correctness: {
    defects_before: detectDefects(mesh).length,
    defects_after_frames_only: detectDefects(repaired).length,
    max_unit_error: err.maxUnit,
    max_ortho_error: err.maxOrtho,
    max_tangent_unit_error: err.maxTangentUnit,
  },
};
writeFileSync(new URL("./result.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));