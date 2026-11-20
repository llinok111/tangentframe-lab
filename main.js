// main.js — rendering + interaction only. All triage/repair math comes from src/core.mjs.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { detectDefects, repairFrames, frameErrors } from "./src/core.mjs";

const view = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f14);
const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.01, 100);
camera.position.set(2.1, 1.35, 2.4);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(3, 4, 2);
scene.add(key);

const mesh = await fetch("./data/mesh.json").then((r) => r.json());

const defects = detectDefects(mesh);
const repaired = repairFrames(mesh);
const err = frameErrors(repaired);
const defectVerts = new Set(defects.filter((d) => d.kind !== "degenerate-triangle").map((d) => d.vertex));

// Build one BufferGeometry with vertex colours: repaired normal -> RGB, defects -> red.
const positions = new Float32Array(mesh.normals.length * 3);
const colors = new Float32Array(positions.length);
for (let i = 0; i < mesh.normals.length; i++) {
  const p = mesh.positions[i], n = repaired.normals[i];
  positions.set(p, i * 3);
  if (defectVerts.has(i)) colors.set([1.0, 0.25, 0.25], i * 3);
  else colors.set([n[0] * 0.5 + 0.5, n[1] * 0.5 + 0.5, n[2] * 0.5 + 0.5], i * 3);
}
const index = [];
for (const t of mesh.indices) index.push(t[0], t[1], t[2]);
const geo = new THREE.BufferGeometry();
geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
geo.setIndex(index);
geo.computeVertexNormals();
const mat = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.55, metalness: 0.05,
  side: THREE.DoubleSide, flatShading: false,
});
const mesh3d = new THREE.Mesh(geo, mat);
scene.add(mesh3d);

// defect markers
const markerGeo = new THREE.SphereGeometry(0.022, 8, 8);
const markerMat = new THREE.MeshBasicMaterial({ color: 0xff5a5a });
const markers = new THREE.InstancedMesh(markerGeo, markerMat, Math.max(1, defectVerts.size));
let k = 0;
const dummy = new THREE.Object3D();
for (const v of defectVerts) {
  dummy.position.set(...mesh.positions[v]);
  dummy.updateMatrix();
  markers.setMatrixAt(k++, dummy.matrix);
}
markers.count = k;
scene.add(markers);

const setText = (id, text, cls) => {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = "v " + (cls || "");
};
setText("counts", `${mesh.normals.length} / ${mesh.indices.length}`);
setText("defects", `${defects.length} (${defectVerts.size} verts)`, "bad");
const after = detectDefects(repaired);
setText("after", `${after.length} (geometry only)`, "ok");
setText("ortho", err.maxOrtho.toExponential(2), "ok");
setText("unit", err.maxUnit.toExponential(2), "ok");
setText("geom", JSON.stringify([mesh.positions, mesh.indices]) === JSON.stringify([repaired.positions, repaired.indices]) ? "yes" : "NO", "ok");
console.log("core in browser:", { defects: defects.length, after: after.length, maxOrtho: err.maxOrtho });

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

let t = 0;
renderer.setAnimationLoop(() => {
  t += 0.003;
  mesh3d.rotation.y = t * 0.25;
  markers.rotation.y = mesh3d.rotation.y;
  controls.update();
  renderer.render(scene, camera);
});