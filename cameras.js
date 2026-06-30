const CAMERA_PREFERENCES_KEY = "lokx_camera_preferences_v1";
const DASHBOARD_PREFERENCES_KEY = "lokx_camera_dashboard_v1";
const get = (selector) => document.querySelector(selector);

const streams = new Map();
let devices = [];

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
}
function saveDashboard(changes = {}) {
  const next = { ...readJson(DASHBOARD_PREFERENCES_KEY), ...changes, updatedAt:new Date().toISOString(), version:1 };
  try { localStorage.setItem(DASHBOARD_PREFERENCES_KEY, JSON.stringify(next)); } catch {}
}

function deviceReference(device) {
  return device ? { deviceId: device.deviceId, groupId: device.groupId, label: device.label } : null;
}

function findMatchingDevice(reference) {
  if (!reference) return null;
  if (typeof reference === "string") return devices.find((device) => device.deviceId === reference) || null;
  return devices.find((device) => device.deviceId === reference.deviceId)
    || devices.find((device) => reference.groupId && device.groupId === reference.groupId)
    || devices.find((device) => reference.label && device.label === reference.label)
    || null;
}

async function permissionState() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return "insecure";
  if (!navigator.permissions?.query) return "unknown";
  try { return (await navigator.permissions.query({name:"camera"})).state; } catch { return "unknown"; }
}

async function updatePermissionUI() {
  const state = await permissionState();
  get("#permission-state").textContent = state.toUpperCase();
  get("#secure-state").textContent = `SECURE_CONTEXT: ${window.isSecureContext ? "OK" : "HTTPS_REQUIRED"}`;
  if (state === "insecure") get("#dashboard-message").textContent = "câmeras exigem HTTPS ou localhost";
  return state;
}

function updateCounts() {
  get("#device-count").textContent = devices.length;
  get("#active-count").textContent = streams.size;
}

function deviceCard(device, index) {
  const card = document.createElement("article");
  card.className = "camera-card";
  card.dataset.deviceId = device.deviceId;
  card.innerHTML = `
    <header class="camera-card__header">
      <strong>${device.label || `Câmera ${index + 1}`}</strong>
      <span>VIDEO_INPUT_${String(index + 1).padStart(2,"0")}</span>
    </header>
    <div class="camera-preview">
      <video autoplay playsinline muted></video>
      <div class="camera-preview__state">STANDBY</div>
    </div>
    <div class="camera-card__meta">
      <span>READY</span><span class="camera-resolution">0 × 0</span><span class="camera-fps">-- FPS</span>
    </div>
    <footer class="camera-card__controls">
      <button data-action="toggle" type="button">[ ATIVAR ]</button>
      <button data-action="mirror" type="button">[ ESPELHAR ]</button>
      <button data-action="primary" type="button">[ USAR_NO_SCANNER ]</button>
    </footer>`;
  card.addEventListener("click", (event) => {
    const action = event.target.closest("button")?.dataset.action;
    if (action === "toggle") streams.has(device.deviceId) ? stopCamera(device.deviceId) : startCamera(device.deviceId);
    if (action === "mirror") toggleMirror(device.deviceId);
    if (action === "primary") setPrimaryCamera(device.deviceId);
  });
  return card;
}

function syncCardWithStream(deviceId, stream) {
  const card = get("#camera-grid").querySelector(`[data-device-id="${CSS.escape(deviceId)}"]`);
  if (!card || !stream) return;

  const video = card.querySelector("video");
  const settings = stream.getVideoTracks()[0]?.getSettings() || {};
  video.srcObject = stream;
  video.play().catch(() => {});
  card.querySelector(".camera-preview__state").hidden = true;
  card.classList.add("is-streaming");
  const button = card.querySelector('[data-action="toggle"]');
  button.textContent = "[ PARAR ]";
  button.classList.add("is-active");
  card.querySelector(".camera-resolution").textContent = `${settings.width || video.videoWidth || 0} × ${settings.height || video.videoHeight || 0}`;
  card.querySelector(".camera-fps").textContent = `${Math.round(settings.frameRate || 0)} FPS`;
}

function renderDevices() {
  const grid = get("#camera-grid");
  grid.replaceChildren(...devices.map(deviceCard));
  get("#camera-empty").hidden = devices.length > 0;
  const preferences = readJson(DASHBOARD_PREFERENCES_KEY);
  const mirroredReferences = preferences.mirroredDevices
    || (preferences.mirroredDeviceIds || []).map((deviceId) => ({ deviceId }));
  mirroredReferences.forEach((reference) => {
    const device = findMatchingDevice(reference);
    if (!device) return;
    const preview = grid.querySelector(`[data-device-id="${CSS.escape(device.deviceId)}"] .camera-preview`);
    if (preview) preview.classList.add("is-mirrored");
  });
  streams.forEach((stream, deviceId) => syncCardWithStream(deviceId, stream));
  updateCounts();
}

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    get("#dashboard-message").textContent = "MediaDevices indisponível: use HTTPS ou localhost";
    return;
  }
  const all = await navigator.mediaDevices.enumerateDevices();
  devices = all.filter((device) => device.kind === "videoinput");
  const availableIds = new Set(devices.map((device) => device.deviceId));
  let removedActiveStream = false;
  streams.forEach((stream, deviceId) => {
    if (availableIds.has(deviceId)) return;
    stream.getTracks().forEach((track) => track.stop());
    streams.delete(deviceId);
    removedActiveStream = true;
  });
  if (removedActiveStream) persistActiveStreams();
  renderDevices();
  get("#dashboard-message").textContent = devices.length ? "fontes sincronizadas" : "nenhuma fonte de vídeo encontrada";
}

async function requestPermission() {
  if (!navigator.mediaDevices?.getUserMedia) {
    get("#dashboard-message").textContent = "bloqueado: publique em HTTPS ou use localhost";
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({video:true,audio:false});
    stream.getTracks().forEach((track)=>track.stop());
    await updatePermissionUI();
    await refreshDevices();
  } catch (error) {
    get("#dashboard-message").textContent = error.name === "NotAllowedError" ? "permissão negada pelo navegador" : error.message;
  }
}

async function startCamera(deviceId) {
  if (streams.has(deviceId)) return;
  const card = get("#camera-grid").querySelector(`[data-device-id="${CSS.escape(deviceId)}"]`);
  if (!card) return;
  const state = card.querySelector(".camera-preview__state");
  state.hidden = false; state.textContent = "CONNECTING..."; card.classList.remove("is-error");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:deviceId},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30}},audio:false});
    const video = card.querySelector("video"); video.srcObject = stream; await video.play();
    streams.set(deviceId,stream); syncCardWithStream(deviceId, stream);
    stream.getVideoTracks()[0].addEventListener("ended",()=>stopCamera(deviceId));
    persistActiveStreams(); updateCounts();
  } catch(error) {
    state.hidden=false; state.textContent=error.name === "NotReadableError" ? "BUSY_IN_ANOTHER_APP" : `ERROR: ${error.name}`;
    card.classList.add("is-error"); get("#dashboard-message").textContent=`Falha em uma fonte: ${error.message}`;
  }
}

function stopCamera(deviceId) {
  const stream=streams.get(deviceId); if(stream) stream.getTracks().forEach(track=>track.stop()); streams.delete(deviceId);
  const card=get("#camera-grid").querySelector(`[data-device-id="${CSS.escape(deviceId)}"]`); if(card){card.querySelector("video").srcObject=null;card.querySelector(".camera-preview__state").hidden=false;card.querySelector(".camera-preview__state").textContent="STANDBY";card.classList.remove("is-streaming");const button=card.querySelector('[data-action="toggle"]');button.textContent="[ ATIVAR ]";button.classList.remove("is-active");}
  persistActiveStreams(); updateCounts();
}
function stopAll(){[...streams.keys()].forEach(stopCamera)}
function disposeStreams(){streams.forEach((stream)=>stream.getTracks().forEach((track)=>track.stop()));streams.clear()}
async function startAll(){for(const device of devices) await startCamera(device.deviceId)}
function persistActiveStreams(){
  const activeDevices = [...streams.keys()].map((id) => deviceReference(devices.find((device) => device.deviceId === id))).filter(Boolean);
  saveDashboard({activeDeviceIds:activeDevices.map((device)=>device.deviceId),activeDevices});
}

function toggleMirror(deviceId){const preview=get("#camera-grid").querySelector(`[data-device-id="${CSS.escape(deviceId)}"] .camera-preview`);if(!preview)return;preview.classList.toggle("is-mirrored");const mirrored=[...get("#camera-grid").querySelectorAll(".camera-preview.is-mirrored")].map(el=>el.closest(".camera-card").dataset.deviceId);const mirroredDevices=mirrored.map((id)=>deviceReference(devices.find((device)=>device.deviceId===id))).filter(Boolean);saveDashboard({mirroredDeviceIds:mirrored,mirroredDevices})}
function setPrimaryCamera(deviceId){const current=readJson(CAMERA_PREFERENCES_KEY);const device=devices.find((item)=>item.deviceId===deviceId);try{localStorage.setItem(CAMERA_PREFERENCES_KEY,JSON.stringify({...current,preferredDeviceId:deviceId,preferredDeviceGroupId:device?.groupId||"",preferredDeviceLabel:device?.label||"",updatedAt:new Date().toISOString(),version:1}))}catch{};get("#dashboard-message").textContent="câmera principal salva para o scanner"}

async function restoreIfAllowed(){const preferences=readJson(DASHBOARD_PREFERENCES_KEY);get("#restore-cameras").checked=Boolean(preferences.autoRestore);if(!preferences.autoRestore)return;const state=await permissionState();if(state!=="granted")return;const references=preferences.activeDevices||(preferences.activeDeviceIds||[]).map((deviceId)=>({deviceId}));for(const reference of references){const device=findMatchingDevice(reference);if(device)await startCamera(device.deviceId)}}

get("#grant-cameras").addEventListener("click",requestPermission);
get("#refresh-devices").addEventListener("click",refreshDevices);
get("#start-all-cameras").addEventListener("click",startAll);
get("#stop-all-cameras").addEventListener("click",stopAll);
get("#restore-cameras").addEventListener("change",event=>saveDashboard({autoRestore:event.target.checked}));
navigator.mediaDevices?.addEventListener?.("devicechange",refreshDevices);
window.addEventListener("beforeunload",disposeStreams);

await updatePermissionUI();
await refreshDevices();
await restoreIfAllowed();
