// Three JS Modules
import * as THREE from "three";

import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { AnimationMixer } from "three";

// Post Processing
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

// Debugging Tools
import Stats from "three/examples/jsm/libs/stats.module.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";

let camera, scene, renderer, composer, controls;
let room;
let currentInteractable = null;
let interactionHintDiv;
window.isDoorOpen = false;
window.doorGroup = null;
let isCrouching = false;
let crouchStage = 0; // 0: Ayakta, 1: Çök, 2: Kapan, 3: Tutun
let tourActive = false;
let tourStep = 0;
let tourTime = 0;
const CROUCH_HEIGHT = 0.8;
const EYE_HEIGHT = 1.6;

const clock = new THREE.Clock();
let deltaTime;

const moveState = { forward: false, backward: false, left: false, right: false };
const moveSpeed = 2.5;

function onKeyDown(event) {
  switch (event.code) {
    case "KeyW": moveState.forward = true; break;
    case "KeyS": moveState.backward = true; break;
    case "KeyA": moveState.left = true; break;
    case "KeyD": moveState.right = true; break;
    case "KeyE":
      if (event.repeat) return;
      if (earthquakeActive) {
        // Otomatik olarak masaya veya sehpaya çek ve çömel
        const dDesk = camera.position.distanceTo(new THREE.Vector3(0, 0, -1.5));
        const dCoffee = camera.position.distanceTo(new THREE.Vector3(-1.8, 0, 0.5));
        const isDesk = dDesk < dCoffee;
        const targetPos = isDesk ? new THREE.Vector3(0, camera.position.y, -1.5) : new THREE.Vector3(-1.8, camera.position.y, 0.5);
        if (!isCrouching) camera.position.lerp(targetPos, 1.0); // Anında çek
        toggleCrouch();
      } else if (isCrouching) {
        toggleCrouch();
      } else if (currentInteractable) {
        handleInteraction(currentInteractable);
      }
      break;
    case "Space":
      if (!earthquakeActive && !scenarioEnded) {
        window.earthquakeSimulation.startScenario();
      }
      break;
    case "KeyC":
      if (event.repeat) return;
      toggleCrouch();
      break;
  }
}

function onKeyUp(event) {
  switch (event.code) {
    case "KeyW": moveState.forward = false; break;
    case "KeyS": moveState.backward = false; break;
    case "KeyA": moveState.left = false; break;
    case "KeyD": moveState.right = false; break;
  }
}

function handleInteraction(object) {
  let name = "";
  let current = object;
  while(current && !name) {
    if (current.name) name = current.name;
    current = current.parent;
  }

  if (name === "Door") {
    toggleDoor();
  } else if (name === "alarmButton" && !alarmActive) {
    activateAlarm();
  } else if (name === "desk") {
    toggleCrouch();
  }
}

function toggleCrouch() {
  crouchStage = (crouchStage + 1) % 4;
  isCrouching = crouchStage > 0;
  
  const targetHeight = isCrouching ? CROUCH_HEIGHT : EYE_HEIGHT;
  camera.position.y = targetHeight;
  
  let msg = "";
  switch(crouchStage) {
    case 0: msg = "🧍 Ayağa Kalktınız"; break;
    case 1: msg = "🙇 ÇÖK: Diz çöktünüz."; break;
    case 2: msg = "🛡️ KAPAN: Başınızı koruyorsunuz."; break;
    case 3: msg = "🤝 TUTUN: Masaya tutundunuz. (Tam Koruma!)"; break;
  }
  
  // Apply a small tilt for 'Kapan' (Stage 2 & 3)
  if (crouchStage >= 2) {
    camera.rotation.x = -0.3; // Look down slightly
  } else {
    camera.rotation.x = 0;
  }
  
  showMessage(msg, 2000);
}

function toggleDoor() {
  if (!window.doorGroup) return;
  
  // Sarsıntı bittiğinde E'ye basarsa direkt tahliye olsun
  if (!earthquakeActive && startTime > 0 && !scenarioEnded) {
    window.isDoorOpen = true;
    window.doorGroup.rotation.y = -Math.PI / 2;
    showMessage("🚪 Tahliye Oluyorsunuz...", 2000);

    const vignette = document.getElementById("vignette");
    if (vignette) {
      vignette.style.background = "white";
      vignette.style.opacity = "1";
      vignette.style.transition = "opacity 1.5s ease-in";
    }
    
    const scoreBase = (safeZoneTime / (earthquakeDuration * 0.5)) * 90;
    const score = Math.min(100, Math.round(scoreBase) + (alarmActive ? 10 : 0));
    
    setTimeout(() => endScenario(score >= 40 ? "success" : "failed"), 1500);
    return;
  }

  window.isDoorOpen = !window.isDoorOpen;
  window.doorGroup.rotation.y = window.isDoorOpen ? -Math.PI / 2 : 0;
  showMessage(window.isDoorOpen ? "🚪 Kapı Açıldı" : "🚪 Kapı Kapandı", 1000);
}

function clampInsideRoom(position) {
  const roomHalfSize = 2.4;
  const wallZ = 2.5;
  const doorHalfWidth = 0.5;

  if (position.x > roomHalfSize) position.x = roomHalfSize;
  if (position.x < -roomHalfSize) position.x = -roomHalfSize;
  if (position.z < -roomHalfSize) position.z = -roomHalfSize;
  if (position.z > 6.0) position.z = 6.0;

  if (position.z > 2.2 && position.z < 2.9) {
    if (Math.abs(position.x) >= doorHalfWidth) {
      // Duvarlara çarpma
      position.z = position.z < wallZ ? 2.2 : 2.9;
    } else if (!window.isDoorOpen) {
      // Kapı kapalıysa çarpma
      position.z = position.z < wallZ ? 2.2 : 2.9;
    }
  }
}

function updateFirstPersonMovement(delta) {
  if (!controls || !controls.isLocked) return;
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  direction.y = 0;
  direction.normalize();

  const strafe = new THREE.Vector3();
  strafe.crossVectors(direction, camera.up).normalize();

  const velocity = new THREE.Vector3();
  if (moveState.forward) velocity.add(direction);
  if (moveState.backward) velocity.sub(direction);
  if (moveState.left) velocity.sub(strafe);
  if (moveState.right) velocity.add(strafe);

  if (velocity.lengthSq() > 0) {
    velocity.normalize().multiplyScalar(moveSpeed * delta);
    camera.position.add(velocity);
    clampInsideRoom(camera.position);
  }
  
  // Set height based on crouching state
  const targetHeight = isCrouching ? CROUCH_HEIGHT : EYE_HEIGHT;
  camera.position.y = targetHeight;
}

const loader = new GLTFLoader().setPath("/assets/3D/");
const hdriLoader = new RGBELoader().setPath("/assets/hdri/");

const REALISTIC_MODELS = {
  desk: { file: "office_desk.glb", pos: [0, 0, -1.5] },
  monitor: { file: "computer_monitor.glb", pos: [0, 0.9, -2], scale: 0.3 },
  keyboard: { file: "mouse_and_keyboard.glb", pos: [-0.2, 1.1, -1.45], scale: 0.07 },
  chair: { file: "office_chair.glb", pos: [0, 0, -1], scale: 0.8, rot: [0, Math.PI, 0] },
  alarmButton: { file: "fire_alarm.glb", pos: [-2.4, 1.4, 1.8], scale: 0.9 },
  plant: { file: "majesty_palm_plant.glb", pos: [2.0, 0, -2.0], scale: 1.5 },
  panel: { file: "electrical_panel.glb", pos: [2.4, 1.5, 1.0], scale: 0.8, rot: [0, -Math.PI/2, 0] },
  coffeeTable: { file: "office_desk.glb", pos: [-1.8, 0, 0.5], scale: 0.4, rot: [0, Math.PI/4, 0] },
};

const loadedModels = {};
let earthquakeActive = false;
let timerStarted = false;
let startTime = 0;
let userScore = 0;
let decisionLog = [];
let scenarioEnded = false;
let safeZoneTime = 0;
let insideSafeZone = false;
const earthquakeDuration = 10000;

async function init() {
  const container = document.createElement("div");
  document.body.appendChild(container);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100);
  camera.position.set(0, EYE_HEIGHT, 2.0);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  
  // Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(5, 10, 5);
  scene.add(sun);

  window.mainLights = new THREE.Group();
  window.mainLights.add(new THREE.PointLight(0xffffff, 1.5, 10));
  scene.add(window.mainLights);

  window.emergencyLights = new THREE.Group();
  const redL = new THREE.PointLight(0xff0000, 2, 10);
  redL.position.set(0, 2.8, 0);
  window.emergencyLights.add(redL);
  window.emergencyLights.visible = false;
  scene.add(window.emergencyLights);

  await createRoom();
  await loadModels();

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);

  controls = new PointerLockControls(camera, document.body);
  
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  animate();
}

async function loadModels() {
  for (const [key, cfg] of Object.entries(REALISTIC_MODELS)) {
    loader.load(cfg.file, (gltf) => {
      const m = gltf.scene;
      m.position.set(...cfg.pos);
      if (cfg.scale) {
        if (Array.isArray(cfg.scale)) m.scale.set(...cfg.scale);
        else m.scale.setScalar(cfg.scale);
      }
      if (cfg.rot) m.rotation.set(...cfg.rot);
      m.name = key; // Set name for interaction (desk, monitor, alarmButton, etc.)
      m.traverse(child => { child.name = key; }); // Apply to all children for raycasting
      scene.add(m);
      loadedModels[key] = m;
    }, undefined, (err) => console.warn(`Model ${key} loaded with error`));
  }
}

async function createRoom() {
  room = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xf5f5f0 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(5, 0.1, 5), new THREE.MeshStandardMaterial({ color: 0x8b6914 }));
  room.add(floor);
  
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 0.1), mat);
  backWall.position.set(0, 1.5, -2.5);
  room.add(backWall);

  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3, 5), mat);
  leftWall.position.set(-2.5, 1.5, 0);
  room.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3, 5), mat);
  rightWall.position.set(2.5, 1.5, 0);
  room.add(rightWall);

  window.doorGroup = new THREE.Group();
  window.doorGroup.position.set(-0.5, 0, 2.5);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1, 2.2, 0.05), new THREE.MeshStandardMaterial({ color: 0x4a3728 }));
  door.position.set(0.5, 1.1, 0);
  door.name = "Door";
  window.doorGroup.add(door);
  room.add(window.doorGroup);


  scene.add(room);
}

function animate() {
  requestAnimationFrame(animate);
  deltaTime = clock.getDelta();

  if (tourActive) {
    updateTour(deltaTime);
  } else {
    updateFirstPersonMovement(deltaTime);
    updateInteraction();
  }

  if (earthquakeActive) {
    const elapsed = Date.now() - startTime;
    // Initial jolt, then gradually decreasing shake
    const intensity = 0.08 * Math.max(0, 1 - (elapsed / earthquakeDuration));
    camera.position.x += (Math.random() - 0.5) * intensity;
    camera.position.z += (Math.random() - 0.5) * intensity;
    
    // --- NEW: FALLING OBJECTS ---
    if (elapsed > 2000 && loadedModels.monitor) {
      // Monitor starts falling after 2 seconds
      if (loadedModels.monitor.rotation.x < Math.PI / 2.5) {
        loadedModels.monitor.rotation.x += 0.05;
        loadedModels.monitor.position.z += 0.01;
      }
    }
    if (loadedModels.keyboard) {
      // Keyboard slides slightly due to shaking
      loadedModels.keyboard.position.x += (Math.random() - 0.5) * 0.01;
    }
    // ----------------------------
    
    // Update timer and status in UI
    const timerDiv = document.getElementById("timer");
    if (timerDiv) timerDiv.textContent = `⏱️ Geçen Süre: ${(elapsed / 1000).toFixed(1)}s`;
    
    const statusDiv = document.getElementById("simulationStatus");
    if (statusDiv) statusDiv.innerHTML = `<span style="color: red; font-weight: bold;">🚨 DEPREM OLUYOR!</span>`;

    const deskPos = new THREE.Vector3(0, 0, -1.5);
    const coffeeTablePos = new THREE.Vector3(-1.8, 0, 0.5);
    const distToDesk = camera.position.distanceTo(deskPos);
    const distToCoffee = camera.position.distanceTo(coffeeTablePos);
    const underDesk = (distToDesk < 1.5 || distToCoffee < 1.5) && camera.position.y < 1.2;
    
    if (underDesk) {
      if (!insideSafeZone) {
        insideSafeZone = true;
        safeZoneTime += 1500; // Girişte bonus
      }
      
      let multiplier = 0;
      if (crouchStage === 1) multiplier = 0.8;
      else if (crouchStage === 2) multiplier = 1.2;
      else if (crouchStage === 3) multiplier = 1.5;
      
      if (multiplier > 0) {
        safeZoneTime += deltaTime * 1000 * multiplier;
        if (Math.random() < 0.01) { // Occasional tip
           let tip = "🛡️ Tam koruma için E tuşuna basmaya devam edin!";
           if (crouchStage === 3) tip = "✅ TAM KORUMA: ÇÖK-KAPAN-TUTUN AKTİF!";
           showMessage(tip, 1500);
        }
      }
    } else {
      insideSafeZone = false;
    }

    if (elapsed > earthquakeDuration) {
      earthquakeActive = false;
      onShakingStopped();
    }
  }

  renderer.render(scene, camera);
}

function onShakingStopped() {
  const status = document.getElementById("simulationStatus");
  if (status) status.innerHTML = `<span style="color: #66ff66;">✅ Sarsıntı Durdu!</span>`;
  
  // Return to normal lights? 
  // No, keep emergency lights on for realism
  
  showMessage("🏃 ŞİMDİ GÜVENLE DIŞARI ÇIKIN! (Önce Alarm, Sonra Kapı)", 6000);
}

function updateTour(delta) {
  tourTime += delta;
  const durationPerStep = 3.0;
  
  const targets = [
    { pos: [1.2, 1.6, 1.2], lookAt: [0, 0.5, -1.5], msg: "🛡️ ADIM 1: Deprem anında HEMEN Masa Altına girin!" },
    { pos: [-1.5, 1.6, 0.5], lookAt: [-2.4, 1.4, 1.8], msg: "🚨 ADIM 2: Sarsıntı durunca binayı Alarmlar uyarın." },
    { pos: [0, 1.6, 0], lookAt: [0, 1.1, 4.0], msg: "🚪 ADIM 3: Sarsıntı durunca KAPIDAN güvenle tahliye olun." }
  ];

  const step = Math.floor(tourTime / durationPerStep);
  if (step < targets.length) {
    const t = targets[step];
    // Simple lerp-like positioning
    camera.position.lerp(new THREE.Vector3(...t.pos), 0.05);
    
    // Look at target
    const targetVec = new THREE.Vector3(...t.lookAt);
    const currentLook = new THREE.Vector3();
    camera.getWorldDirection(currentLook);
    camera.lookAt(targetVec);
    
    showHint(t.msg);
  } else {
    // Tour Finished
    tourActive = false;
    showHint("");
    camera.position.set(0, EYE_HEIGHT, 2.0);
    camera.lookAt(0, EYE_HEIGHT, -10);
    document.getElementById("startScenarioBtn").style.display = "block";
    showMessage("✅ Tanıtım Bitti! Hazırsanız Başlatın.", 3000);
  }
}

function updateInteraction() {
  if (!controls || !controls.isLocked) {
    showHint("");
    return;
  }
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hits = ray.intersectObjects(scene.children, true);
  let found = null;
  
  if (hits.length > 0 && hits[0].distance < 3.5) {
    const obj = hits[0].object;
    let current = obj;
    while(current) {
       if (current.name === "Door" || current.name === "desk" || current.name === "alarmButton") {
         found = current;
         break;
       }
       current = current.parent;
    }
  }

  // FALLBACK: Distance-based detection if raycast misses
  if (!found) {
    const deskPos = new THREE.Vector3(0, 0, -1.5);
    const alarmPos = new THREE.Vector3(-2.4, 1.4, 1.8);
    const distToDesk = camera.position.distanceTo(deskPos);
    const distToAlarm = camera.position.distanceTo(alarmPos);
    
    if (distToDesk < 1.8) {
      found = { name: "desk" };
    } else if (distToAlarm < 1.5) {
      found = { name: "alarmButton" };
    }
  }

  if (found) {
    let hint = "";
    const name = found.name;
    if (name === "Door") {
      hint = `🚪 KAPIYI ${window.isDoorOpen ? "KAPATMAK" : "AÇMAK"} İÇİN [E]`;
    } else if (name === "desk") {
      const stages = ["SAKLANMAK", "KAPANMAK", "TUTUNMAK", "KALKMAK"];
      hint = `🗄️ MASA (GÜVENLİ BÖLGE) - ${stages[crouchStage]} İÇİN [E]`;
    } else if (name === "alarmButton") {
      hint = alarmActive ? "🚨 BİLDİRİM YAPILDI" : "🚨 TEHLİKE BİLDİRİMİ İÇİN [E]";
    }
    
    showHint(hint);
    currentInteractable = found;
    return;
  }
  currentInteractable = null;
  showHint("");
}

function showHint(text) {
  if (!interactionHintDiv) {
    interactionHintDiv = document.createElement("div");
    Object.assign(interactionHintDiv.style, {
      position: 'fixed', top: '55%', left: '50%', transform: 'translate(-50%, -50%)',
      color: 'white', fontWeight: 'bold', textShadow: '0 0 5px black', zIndex: '1000',
      fontSize: '20px', pointerEvents: 'none'
    });
    document.body.appendChild(interactionHintDiv);
  }
  interactionHintDiv.textContent = text;
  interactionHintDiv.style.display = text ? "block" : "none";
}

function showMessage(msg, dur = 3000) {
  const box = document.getElementById("messageBox");
  if (box) {
    box.textContent = msg;
    box.style.display = "block";
    setTimeout(() => box.style.display = "none", dur);
  }
}

function startEarthquake() {
  earthquakeActive = true;
  timerStarted = true;
  startTime = Date.now();
  window.mainLights.visible = false;
  window.emergencyLights.visible = true;
  
  // Update UI
  const instr = document.getElementById("instructions");
  if (instr) instr.classList.add("collapsed");
  
  const timerDiv = document.getElementById("timer");
  if (timerDiv) timerDiv.style.display = "block";

  decisionLog.push({ time: 0, action: "earthquake_started", description: "Deprem başladı!" });
}

let alarmActive = false;
function activateAlarm() {
  if (alarmActive) return;
  alarmActive = true;
  const elapsed = (Date.now() - startTime) / 1000;
  
  decisionLog.push({
    time: Date.now() - startTime,
    action: "alarm_activated",
    description: `Tehlike bildirimi ${elapsed.toFixed(1)} sn içinde yapıldı.`
  });
  
  const btn = document.getElementById("alarmButton");
  if (btn) {
    btn.textContent = "BİLDİRİM YAPILDI! 🚨";
    btn.style.backgroundColor = "red";
    btn.disabled = true;
  }
  
  showMessage("🚨 Tehlike bildirimi sisteme iletildi!", 2000);
  
  try {
    window.alarmAudio = new Audio("assets/audio/alarm.mp3");
    window.alarmAudio.loop = true;
    window.alarmAudio.play();
  } catch(e) {}
}

function stopAlarm() {
  if (window.alarmAudio) {
    window.alarmAudio.pause();
    window.alarmAudio.currentTime = 0;
  }
}

function endEarthquake() {
  // Eski otomatik bitirme fonksiyonu tamamen iptal edildi.
  // Sadece onShakingStopped kullanılıyor.
}

function endScenario(res) {
  if (scenarioEnded) return;
  scenarioEnded = true;
  stopAlarm();
  
  const scoreBase = (safeZoneTime / (earthquakeDuration * 0.5)) * 90;
  const score = Math.min(100, Math.round(scoreBase) + (alarmActive ? 10 : 0));
  const ok = score >= 50 && res !== "failed";
  
  decisionLog.push({
    time: Date.now() - startTime,
    action: ok ? "earthquake_survived" : "earthquake_failed",
    description: ok ? 
      `Masa altına saklanarak (${(safeZoneTime/1000).toFixed(1)} sn) hayatta kaldınız ve tahliye oldunuz.` : 
      "Sarsıntı sırasında masanın altında yeterince uzun süre durmadınız veya yanlış tahliye oldunuz!"
  });
  
  if (alarmActive) {
    decisionLog.push({ time: Date.now() - startTime, action: "alarm_used", description: "Bina uyarısını güvenli zamanda yaptınız." });
  }

  window.userFinalScore = Math.min(100, score);
  
  controls.unlock();
  const screen = document.getElementById("resultScreen");
  if (screen) {
    screen.style.display = "block";
    document.getElementById("resultTitle").textContent = ok ? "🎉 BAŞARILI TAHLİYE!" : "❌ BAŞARISIZ!";
    document.getElementById("scoreText").textContent = `${window.userFinalScore || 0} / 100`;
    document.getElementById("timeText").textContent = `${((Date.now() - startTime) / 1000).toFixed(1)} sn`;
    
    // Summary of performance
    const resultText = document.getElementById("resultText");
    if (resultText) {
      resultText.innerHTML = ok ? 
        "Tebrikler! Önce kendinizi korudunuz, sonra yardımı haberdar edip binayı doğru şekilde tahliye ettiniz." :
        "Maalesef tahliye protokollerine tam olarak uyamadınız. Sarsıntı bitmeden yerinizden çıkmamaya çalışın.";
    }
  }
}

window.earthquakeSimulation = {
  runRoomTour: () => { 
    tourActive = true;
    tourStep = 0;
    tourTime = 0;
    document.getElementById("startScenarioBtn").style.display = "none";
  },
  startScenario: () => {
    // Completely remove the UI elements
    const btnDiv = document.getElementById("startScenarioBtn");
    if (btnDiv) btnDiv.remove(); 
    
    const instr = document.getElementById("instructions");
    if (instr) instr.style.display = "none"; // Hide instructions completely
    
    startEarthquake();
    controls.lock();
  },
  activateAlarm: () => {}
};

window.addEventListener("load", () => {
  setTimeout(() => {
    const intro = document.getElementById("controls-intro");
    if (intro) intro.style.display = "block";
  }, 1000);
});

init();
