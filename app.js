import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import gsap from 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/index.js';

// --- DOM references (will be assigned on page load) ---
let quantumInput, startBtn, resetBtn, currentTimeEl, quantumDisplayEl;
let processTableBody, readyQueueEl, cpuDisplayEl, historyList;
let canvas3d, label3d;

// --- Config & state ---
const TICK_MS = 450;
const MOVE_DUR = 0.45;
const CPU_POS = new THREE.Vector3(0, 0.6, 0);
const CPU_BOX_H = 1.2;
const PROC_BOX_H = 1.2;
const CPU_SLOT_POS = new THREE.Vector3(
  CPU_POS.x,
  CPU_POS.y + (CPU_BOX_H + PROC_BOX_H) / 2 + 0.02,
  CPU_POS.z
);

// lanes: ready above CPU, finished below CPU
const QUEUE_START = new THREE.Vector3(CPU_POS.x - 6, CPU_POS.y, CPU_POS.z + 6);
const QUEUE_SPACING = 2.3;

const FINISH_START = new THREE.Vector3(CPU_POS.x, CPU_POS.y, CPU_POS.z - 6);
const FINISH_SPACING = 1.8;


const initialProcesses = [
  { id: 'P1', burstTime: 8, arrivalTime: 0, color: '#e91e63' },
  { id: 'P2', burstTime: 5, arrivalTime: 2, color: '#9c27b0' },
  { id: 'P3', burstTime: 12, arrivalTime: 4, color: '#3f51b5' },
  { id: 'P4', burstTime: 6, arrivalTime: 6, color: '#009688' },
];

let processes = [];
let readyQueue = [];
let currentTime = 0;
let running = false;
let tickHandle = null;
let currentCPU = null;
let finishedOrder = [];

const three = {
  scene: null, camera: null, renderer: null, labelRenderer: null, controls: null,
  cpuMesh: null,
  procMeshes: new Map(),
};

// --- Utility functions ---
function getQuantum() {
  const q = parseInt(quantumInput.value, 10);
  return Number.isFinite(q) && q > 0 ? q : 1;
}
function logEvent(text) {
  const li = document.createElement('li');
  const t = document.createElement('time');
  // FIX: Using template literal (backticks) for t.textContent
  t.textContent = `[t=${currentTime}]`;
  li.appendChild(t);
  li.appendChild(document.createTextNode(' ' + text));
  historyList.appendChild(li);
  historyList.scrollTop = historyList.scrollHeight;
}

// --- Rendering functions ---
function renderProcessTable() {
  processTableBody.innerHTML = '';
  for (const p of processes) {
    const tr = document.createElement('tr');
    // FIX: Using template literal (backticks) for innerHTML
    tr.innerHTML = `<td>${p.id}</td><td>${p.burstTime}</td><td>${p.arrivalTime}</td><td>${p.remainingTime}</td><td>${p.waitingTime}</td>`;
    processTableBody.appendChild(tr);
  }
}
function renderReadyQueue() {
  readyQueueEl.innerHTML = '';
  for (const p of readyQueue) {
    const span = document.createElement('span');
    span.className = 'chip';
    span.style.background = p.color;
    span.textContent = p.id;
    readyQueueEl.appendChild(span);
  }
}
function renderCPU() {
  if (currentCPU && currentCPU.proc) {
    cpuDisplayEl.textContent = currentCPU.proc.id;
    cpuDisplayEl.style.color = '#fff';
  } else {
    cpuDisplayEl.textContent = 'Idle';
    cpuDisplayEl.style.color = 'var(--muted)';
  }
}
function renderStats() {
  const statsBody = document.getElementById('statsTableBody');
  statsBody.innerHTML = '';
  const finished = processes.filter(p => p.finished);
  for (const p of finished) {
    const TAT = p.completionTime - p.arrivalTime;
    const WT = TAT - p.burstTime;
    const tr = document.createElement('tr');
    // FIX: Using template literal (backticks) for innerHTML
    tr.innerHTML = `<td>${p.id}</td><td>${p.completionTime}</td><td>${TAT}</td><td>${WT}</td>`;
    statsBody.appendChild(tr);
  }
  if (finished.length > 0) {
    const avgTAT = finished.reduce((s, p) => s + (p.completionTime - p.arrivalTime), 0) / finished.length;
    const avgWT = finished.reduce((s, p) => s + ((p.completionTime - p.arrivalTime) - p.burstTime), 0) / finished.length;
    document.getElementById('avgTAT').textContent = avgTAT.toFixed(2);
    document.getElementById('avgWT').textContent = avgWT.toFixed(2);
  } else {
    document.getElementById('avgTAT').textContent = '-';
    document.getElementById('avgWT').textContent = '-';
  }
}

// --- 3D Scene Setup ---
function initThree() {
  const scene = new THREE.Scene();
  three.scene = scene;

  const w = canvas3d.clientWidth || window.innerWidth;
  const h = canvas3d.clientHeight || window.innerHeight;

  const camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 1000);
  camera.position.set(8, 9, 14);
  three.camera = camera;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  canvas3d.appendChild(renderer.domElement);
  three.renderer = renderer;

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(w, h);
  labelRenderer.domElement.style.pointerEvents = 'none';
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.inset = '0';
  label3d.appendChild(labelRenderer.domElement);
  three.labelRenderer = labelRenderer;

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0.6, 0);
  three.controls = controls;

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(3, 7, 4);
  scene.add(dir);

  // Ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 22),
    new THREE.MeshStandardMaterial({ color: 0x10141c, roughness: 0.9, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  scene.add(ground);

  // CPU
  const cpu = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 1.2, 2.2),
    new THREE.MeshStandardMaterial({ color: 0xf7b500, metalness: 0.1, roughness: 0.6 })
  );
  cpu.position.copy(CPU_POS);
  scene.add(cpu);
  three.cpuMesh = cpu;

  const cpuLabelEl = document.createElement('div');
  cpuLabelEl.className = 'label';
  cpuLabelEl.textContent = 'CPU';
  const cpuLabel = new CSS2DObject(cpuLabelEl);
  cpuLabel.position.set(0, 0.9, 0);
  cpu.add(cpuLabel);

  // Lanes
  addLaneMarker(QUEUE_START, 'Ready');
  addLaneMarker(FINISH_START, 'Finished');

  // Process meshes
  for (const p of initialProcesses) {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1.2, 1.2),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(p.color) })
    );
    box.position.set(QUEUE_START.x - 6, 0.6, 0);
    scene.add(box);

    const labelEl = document.createElement('div');
    labelEl.className = 'label';
    labelEl.textContent = p.id;
    const labelObj = new CSS2DObject(labelEl);
    labelObj.position.set(0, 0.9, 0);
    box.add(labelObj);

    three.procMeshes.set(p.id, { mesh: box, label: labelObj });
  }

  function addLaneMarker(pos, text) {
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.1, 6),
      new THREE.MeshStandardMaterial({ color: 0x233142 })
    );
    base.position.set(pos.x - 0.2, 0.05, pos.z);
    scene.add(base);

    const tagEl = document.createElement('div');
    tagEl.className = 'label';
    tagEl.textContent = text;
    const tag = new CSS2DObject(tagEl);
    tag.position.set(0, 0.8, 0);
    base.add(tag);
  }

  // Animate loop
  const onFrame = () => {
    requestAnimationFrame(onFrame);
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  };
  onFrame();

  window.addEventListener('resize', () => {
    const W = canvas3d.clientWidth || window.innerWidth;
    const H = canvas3d.clientHeight || window.innerHeight;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setSize(W, H);
    labelRenderer.setSize(W, H);
  });
}

// --- 3D animation helpers ---
function layoutQueue3D() {
  readyQueue.forEach((p, idx) => {
    const target = new THREE.Vector3(
      QUEUE_START.x + idx * QUEUE_SPACING,
      QUEUE_START.y,
      QUEUE_START.z
    );
    const obj = three.procMeshes.get(p.id);
    if (!obj) return;
    obj.mesh.userData.zone = 'queue';
    gsap.to(obj.mesh.position, { x: target.x, y: target.y, z: target.z, duration: MOVE_DUR, ease: 'power2.inOut' });
  });
}
function moveToCPU(p) {
  const obj = three.procMeshes.get(p.id);
  if (!obj) return;
  obj.mesh.userData.zone = 'cpu';
  gsap.to(obj.mesh.position, {
    x: CPU_SLOT_POS.x, y: CPU_SLOT_POS.y, z: CPU_SLOT_POS.z,
    duration: MOVE_DUR, ease: 'power2.inOut'
  });
}

function moveToFinished(p) {
  const index = finishedOrder.indexOf(p.id);
  const idx = index >= 0 ? index : finishedOrder.length;
  if (index < 0) finishedOrder.push(p.id);
  const target = new THREE.Vector3(FINISH_START.x, FINISH_START.y, FINISH_START.z - idx * FINISH_SPACING);
  const obj = three.procMeshes.get(p.id);
  if (!obj) return;
  obj.mesh.userData.zone = 'finished';
  gsap.to(obj.mesh.position, { x: target.x, y: target.y, z: target.z, duration: MOVE_DUR, ease: 'power2.inOut' });
}

// --- Simulation helpers ---
function arrivalsStep() {
  for (const p of processes) {
    if (!p.arrived && p.arrivalTime <= currentTime) {
      p.arrived = true;
      readyQueue.push(p);
      // FIX: Using template literal (backticks) for logEvent call
      logEvent(`${p.id} arrived and joined Ready Queue`);
      layoutQueue3D();
    }
  }
}
function allFinished() { return processes.every(p => p.finished); }

function tick() {
  // 1) arrivals at current time
  arrivalsStep();

  // 2) dispatch if CPU idle
  if (!currentCPU && readyQueue.length > 0) {
    const next = readyQueue.shift();
    currentCPU = { proc: next, qLeft: getQuantum() };
    moveToCPU(next);
    // FIX: Using template literal (backticks) for logEvent call
    logEvent(`${next.id} moved to CPU`);
  }

  // 3) execute one unit or idle
  if (currentCPU && currentCPU.proc) {
    const p = currentCPU.proc;

    // waiting time for processes already in ready queue
    for (const q of readyQueue) q.waitingTime += 1;

    // run exactly 1 time unit
    p.remainingTime = Math.max(0, p.remainingTime - 1);
    currentCPU.qLeft = Math.max(0, currentCPU.qLeft - 1);

    // advance time
    currentTime += 1;
    currentTimeEl.textContent = String(currentTime);

    // IMPORTANT: arrivals at the new time (aligns with per-unit RR)
    arrivalsStep();

    // completion / quantum expiry handling
    if (p.remainingTime === 0) {
      p.finished = true;
      p.completionTime = currentTime;
      // FIX: Using template literal (backticks) for logEvent call
      logEvent(`${p.id} finished (CT=${p.completionTime})`);
      moveToFinished(p);
      currentCPU = null;
      renderStats();
    } else if (currentCPU.qLeft === 0) {
      readyQueue.push(p);
      // FIX: Using template literal (backticks) for logEvent call
      logEvent(`${p.id} quantum expired, returned to Ready Queue`);
      currentCPU = null;
      layoutQueue3D();
    }
  } else {
    // CPU idle for 1 unit
    currentTime += 1;
    currentTimeEl.textContent = String(currentTime);

    // arrivals during idle should be visible immediately
    arrivalsStep();
  }

  renderProcessTable();
  renderReadyQueue();
  renderCPU();

  if (allFinished()) stopSim();
}

// --- Controls lifecycle ---
function startSim() {
  if (running) return;
  running = true;
  startBtn.disabled = true;
  quantumInput.disabled = true;
  tickHandle = setInterval(tick, TICK_MS);
}
function stopSim() {
  if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
  running = false;
  startBtn.disabled = false;
  quantumInput.disabled = false;
}
function resetSim() { stopSim(); deepReset(); }

function deepReset() {
  if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
  running = false;
  currentTime = 0;
  currentCPU = null;
  finishedOrder = [];
  readyQueue.length = 0;
  processes = initialProcesses.map(p => ({
    ...p,
    remainingTime: p.burstTime,
    waitingTime: 0,
    completionTime: null,
    arrived: false,
    finished: false
  }));
  currentTimeEl.textContent = '0';
  quantumDisplayEl.textContent = String(getQuantum());
  cpuDisplayEl.textContent = 'Idle';
  historyList.innerHTML = '';
  renderProcessTable(); renderReadyQueue(); renderStats();
  for (const p of processes) {
    const obj = three.procMeshes.get(p.id);
    if (!obj) continue;
    // Randomize initial position slightly so they don't spawn in exactly the same spot
    obj.mesh.position.set(QUEUE_START.x - 6, QUEUE_START.y, QUEUE_START.z + (Math.random() * 0.4 - 0.2));
    obj.mesh.userData.zone = 'incoming';
  }
  // arrivalsStep will layout when time advances
}

// --- Main Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  // DOM
  quantumInput = document.getElementById('quantumInput');
  startBtn = document.getElementById('startBtn');
  resetBtn = document.getElementById('resetBtn');
  currentTimeEl = document.getElementById('currentTime');
  quantumDisplayEl = document.getElementById('quantumDisplay');
  processTableBody = document.getElementById('processTableBody');
  readyQueueEl = document.getElementById('readyQueue');
  cpuDisplayEl = document.getElementById('cpuDisplay');
  historyList = document.getElementById('historyList');
  canvas3d = document.getElementById('canvas3d');
  label3d = document.getElementById('label3d');

  // Events
  startBtn.addEventListener('click', startSim);
  resetBtn.addEventListener('click', resetSim);
  quantumInput.addEventListener('input', () => {
    quantumDisplayEl.textContent = String(getQuantum());
  });

  // Setup
  initThree();
  deepReset();
});
