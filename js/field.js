import * as THREE from "three";
import { fieldEnabled, reducedMotion } from "./theme.js";

let renderer;
let scene;
let camera;
let blueLight;
let pinkLight;
let dust;
let raf = 0;
let running = false;
let themeDoc;

function cssColor(name, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw || fallback;
}

function hexToInt(hex) {
  return parseInt(hex.replace("#", ""), 16);
}

function build() {
  const canvas = document.getElementById("field");
  if (!canvas) return;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setClearColor(0x000000, 0);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 80);
  camera.position.set(0, 9.5, 14);
  camera.lookAt(0, 0, 0);

  const grid = new THREE.GridHelper(48, 48, 0x1a1a1a, 0x121212);
  grid.position.y = 0;
  scene.add(grid);

  const ambient = new THREE.AmbientLight(0x202020, 0.35);
  scene.add(ambient);

  blueLight = new THREE.PointLight(hexToInt(cssColor("--blue", "#4D9EFF")), 0.55, 22, 2);
  blueLight.position.set(-6, 4, 3);
  scene.add(blueLight);

  pinkLight = new THREE.PointLight(hexToInt(cssColor("--pink", "#FF4FA3")), 0.4, 22, 2);
  pinkLight.position.set(7, 3.5, -2);
  scene.add(pinkLight);

  const count = 280;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 36;
    positions[i * 3 + 1] = Math.random() * 8;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 36;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0x8a8a8a,
    size: 0.035,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  dust = new THREE.Points(geo, mat);
  scene.add(dust);
}

function tick(t) {
  if (!running) return;
  const s = t * 0.00012;
  if (blueLight) {
    blueLight.position.x = Math.sin(s) * 8;
    blueLight.position.z = Math.cos(s * 0.8) * 6;
  }
  if (pinkLight) {
    pinkLight.position.x = Math.cos(s * 0.7) * 7;
    pinkLight.position.z = Math.sin(s * 1.1) * 5;
  }
  if (dust) dust.rotation.y = s * 0.15;
  renderer.render(scene, camera);
  raf = requestAnimationFrame(tick);
}

function resize() {
  if (!renderer || !camera) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}

export function stopField() {
  running = false;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  const canvas = document.getElementById("field");
  if (canvas) canvas.style.display = "none";
}

export function startField() {
  const canvas = document.getElementById("field");
  if (!canvas) return;
  if (reducedMotion() || (themeDoc && !fieldEnabled(themeDoc))) {
    stopField();
    return;
  }
  canvas.style.display = "block";
  if (!renderer) build();
  else {
    blueLight.color.set(cssColor("--blue", "#4D9EFF"));
    pinkLight.color.set(cssColor("--pink", "#FF4FA3"));
  }
  if (!running) {
    running = true;
    raf = requestAnimationFrame(tick);
  }
}

export function syncField(doc) {
  themeDoc = doc;
  if (fieldEnabled(doc) && !reducedMotion()) startField();
  else stopField();
}

window.addEventListener("resize", resize);
