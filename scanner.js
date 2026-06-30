import {
  DrawingUtils,
  FaceLandmarker,
  FilesetResolver,
} from "./assets/mediapipe/vision_bundle.mjs";
import { analyzeImageSignals, analyzeLandmarks, analyzeLandmarkSamples } from "./analysis-engine.js";

const GREEN = "#b9ff4f";
const GREEN_FAINT = "rgba(185, 255, 79, 0.16)";
const CAMERA_PREFERENCES_KEY = "lokx_camera_preferences_v1";
const get = (selector) => document.querySelector(selector);

const scannerModal = get("#scanner-modal");
const video = get("#face-video");
const canvas = get("#face-overlay");
const context = canvas.getContext("2d");
const stage = get("#video-stage");
const cameraGate = get("#camera-gate");
const cameraError = get("#camera-error");
const secureContextNote = get("#secure-context-note");
const cameraSelect = get("#camera-select");
const presentationTarget = get("#presentation-target");
const uploadAnalysisButton = get("#upload-analysis-photo");
const analysisPhotoFile = get("#analysis-photo-file");
const mirrorCamera = get("#mirror-camera");
const autoCamera = get("#auto-camera");
const modelStatus = get("#scanner-model-status");
const instructionIndex = get("#instruction-index");
const instruction = get("#scan-instruction");
const scanDetail = get("#scan-detail");
const progressBar = get("#capture-progress-bar");
const progressValue = get("#progress-value");
const progressStage = get("#progress-stage");
const faceLock = get("#face-lock");
const faceLockValue = get("#face-lock-value");
const restartButton = get("#restart-capture");
const viewResultsButton = get("#view-results");
const streamLabel = get("#stream-label");
const streamResolution = get("#stream-resolution");
const fpsLabel = get("#face-fps");

const qualityElements = {
  face: get("#check-face"),
  size: get("#check-size"),
  center: get("#check-center"),
  light: get("#check-light"),
};

const steps = [
  {
    title: "Olhe diretamente para a câmera.",
    detail: "Mantenha a expressão neutra e encaixe o rosto dentro das marcações.",
    duration: 3000,
    requireCenter: true,
  },
  {
    title: "Vire lentamente para sua esquerda.",
    detail: "Pare por um instante quando enxergar apenas três quartos do rosto.",
    duration: 3200,
  },
  {
    title: "Agora vire lentamente para a direita.",
    detail: "Mantenha os olhos abertos e evite inclinar o pescoço.",
    duration: 3200,
  },
  {
    title: "Levante levemente o queixo.",
    detail: "Um movimento pequeno é suficiente para mapear o terço inferior.",
    duration: 2600,
  },
  {
    title: "Abaixe levemente o queixo.",
    detail: "Continue imóvel até a barra chegar ao final.",
    duration: 2600,
  },
];

const qualityCanvas = document.createElement("canvas");
qualityCanvas.width = 32;
qualityCanvas.height = 24;
const qualityContext = qualityCanvas.getContext("2d", { willReadFrequently: true });

let currentStream = null;
let currentMode = "camera";
let faceLandmarker = null;
let drawingUtils = null;
let modelPromise = null;
let imageLandmarker = null;
let imageModelPromise = null;
let animationFrame = 0;
let lastVideoTime = -1;
let lastFrameAt = 0;
let fpsSampleAt = 0;
let fpsFrames = 0;
let brightness = 128;
let brightnessSampleAt = 0;
let stepIndex = 0;
let stepElapsed = 0;
let previousTick = 0;
let lastSampleAt = 0;
let scanComplete = false;
let sessionSamples = [];
let frontVisualSignals = null;
let frontVisualSignalSamples = [];
let lastVisualSignalAt = 0;
let referencePitch = null;
let firstYawDirection = 0;
let firstPitchDirection = 0;
let navigatingToReport = false;

const ANALYSIS_TRANSFER_KEY = "lokx_analysis_result_v1";
const ANALYSIS_TRANSFER_TTL_MS = 60 * 1000;

function storeOneTimeAnalysis(analysis) {
  const now = Date.now();
  sessionStorage.setItem(ANALYSIS_TRANSFER_KEY, JSON.stringify({
    kind: "lokx-one-time-analysis",
    createdAt: now,
    expiresAt: now + ANALYSIS_TRANSFER_TTL_MS,
    payload: analysis,
  }));
}

function readCameraPreferences() {
  try {
    return JSON.parse(localStorage.getItem(CAMERA_PREFERENCES_KEY)) || {};
  } catch {
    return {};
  }
}

function saveCameraPreferences(changes = {}) {
  const current = readCameraPreferences();
  const next = {
    ...current,
    ...changes,
    updatedAt: new Date().toISOString(),
    version: 1,
  };
  try {
    localStorage.setItem(CAMERA_PREFERENCES_KEY, JSON.stringify(next));
  } catch {
    // Preferências não essenciais; o scanner continua funcionando sem armazenamento.
  }
}

async function currentCameraIdentity(deviceId, fallbackLabel = "") {
  if (!navigator.mediaDevices?.enumerateDevices) return { preferredDeviceId: deviceId, preferredDeviceLabel: fallbackLabel };
  const all = await navigator.mediaDevices.enumerateDevices();
  const device = all.find((item) => item.kind === "videoinput" && item.deviceId === deviceId);
  return {
    preferredDeviceId: deviceId,
    preferredDeviceGroupId: device?.groupId || "",
    preferredDeviceLabel: device?.label || fallbackLabel,
  };
}

async function resolvePreferredDeviceId(preferences) {
  if (!navigator.mediaDevices?.enumerateDevices) return preferences.preferredDeviceId || "";
  const all = await navigator.mediaDevices.enumerateDevices();
  const cameras = all.filter((device) => device.kind === "videoinput");
  const match = cameras.find((device) => device.deviceId === preferences.preferredDeviceId)
    || cameras.find((device) => preferences.preferredDeviceGroupId && device.groupId === preferences.preferredDeviceGroupId)
    || cameras.find((device) => preferences.preferredDeviceLabel && device.label === preferences.preferredDeviceLabel);
  return match?.deviceId || "";
}

function setCameraError(message = "") {
  cameraError.textContent = message;
}

function permissionEnvironmentMessage() {
  if (window.isSecureContext) {
    secureContextNote.textContent = "CONTEXTO_SEGURO: OK // a permissão será controlada pelo navegador";
    return;
  }

  secureContextNote.textContent = "CONTEXTO_SEGURO: FALHOU // câmera exige HTTPS ou localhost";
  setCameraError(
    "Este endereço HTTP não pode abrir a câmera. No computador use localhost; no celular publique com HTTPS.",
  );
}

function stopCurrentStream() {
  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
    currentStream = null;
  }
  video.srcObject = null;
  window.cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  context.clearRect(0, 0, canvas.width, canvas.height);
}

function wipeCanvas(target) {
  if (!target) return;
  const targetContext = target.getContext?.("2d");
  targetContext?.clearRect(0, 0, target.width, target.height);
  target.width = 1;
  target.height = 1;
}

function discardCapturedBiometrics({ preserveTransfer = false, closeModels = false } = {}) {
  sessionSamples.fill(null);
  sessionSamples.length = 0;
  frontVisualSignals = null;
  frontVisualSignalSamples.fill(null);
  frontVisualSignalSamples.length = 0;
  lastVisualSignalAt = 0;
  referencePitch = null;
  firstYawDirection = 0;
  firstPitchDirection = 0;
  delete window.lokxLastScan;
  analysisPhotoFile.value = "";
  context.clearRect(0, 0, canvas.width, canvas.height);
  qualityCanvas.width = 1;
  qualityCanvas.height = 1;
  qualityCanvas.width = 32;
  qualityCanvas.height = 24;
  if (!preserveTransfer) sessionStorage.removeItem(ANALYSIS_TRANSFER_KEY);
  if (closeModels) {
    try { faceLandmarker?.close(); } catch {}
    try { imageLandmarker?.close(); } catch {}
    faceLandmarker = null;
    imageLandmarker = null;
    modelPromise = null;
    imageModelPromise = null;
  }
}

function resetSequence() {
  stepIndex = 0;
  stepElapsed = 0;
  previousTick = performance.now();
  lastSampleAt = 0;
  scanComplete = false;
  sessionSamples.fill(null);
  sessionSamples.length = 0;
  sessionSamples = [];
  frontVisualSignals = null;
  frontVisualSignalSamples.fill(null);
  frontVisualSignalSamples.length = 0;
  lastVisualSignalAt = 0;
  referencePitch = null;
  firstYawDirection = 0;
  firstPitchDirection = 0;
  restartButton.disabled = false;
  viewResultsButton.hidden = true;
  updateInstruction();
  updateProgress(0);
}

function updateInstruction() {
  if (scanComplete) {
    instructionIndex.textContent = "OK";
    instruction.textContent = "Mapeamento concluído.";
    scanDetail.textContent = "Landmarks descartados após gerar o resumo de uso único.";
    progressStage.textContent = "CAPTURA_COMPLETA";
    return;
  }

  const activeStep = steps[stepIndex];
  if (!activeStep) return;
  instructionIndex.textContent = String(stepIndex + 1).padStart(2, "0");
  instruction.textContent = activeStep.title;
  scanDetail.textContent = activeStep.detail;
  progressStage.textContent = `ETAPA ${String(stepIndex + 1).padStart(2, "0")}/${String(steps.length).padStart(2, "0")}`;
}

function updateProgress(value) {
  const bounded = Math.max(0, Math.min(100, value));
  progressBar.style.width = `${bounded}%`;
  progressValue.textContent = `${Math.round(bounded)}%`;
}

async function initializeModel() {
  if (faceLandmarker) return faceLandmarker;
  if (modelPromise) return modelPromise;

  modelStatus.textContent = "MODEL_STATUS: LOADING";
  instruction.textContent = "Carregando a malha facial local...";
  scanDetail.textContent = "O modelo é executado no seu aparelho; os frames não são enviados para análise externa.";

  modelPromise = (async () => {
    const wasmPath = new URL("./assets/mediapipe/wasm", import.meta.url).href;
    const modelPath = new URL("./assets/models/face_landmarker.task", import.meta.url).href;
    const vision = await FilesetResolver.forVisionTasks(wasmPath);
    const options = {
      baseOptions: { modelAssetPath: modelPath, delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    };

    try {
      faceLandmarker = await FaceLandmarker.createFromOptions(vision, options);
    } catch {
      options.baseOptions.delegate = "CPU";
      faceLandmarker = await FaceLandmarker.createFromOptions(vision, options);
    }

    drawingUtils = new DrawingUtils(context);
    modelStatus.textContent = "MODEL_STATUS: READY // 478 3D LANDMARKS + MATRIX";
    resetSequence();
    return faceLandmarker;
  })().catch((error) => {
    modelPromise = null;
    modelStatus.textContent = "MODEL_STATUS: ERROR";
    setCameraError(`Não foi possível carregar a malha facial: ${error.message}`);
    throw error;
  });

  return modelPromise;
}

async function initializeImageModel() {
  if (imageLandmarker) return imageLandmarker;
  if (imageModelPromise) return imageModelPromise;
  modelStatus.textContent = "MODEL_STATUS: LOADING_IMAGE_MODE";
  imageModelPromise = (async () => {
    const wasmPath = new URL("./assets/mediapipe/wasm", import.meta.url).href;
    const modelPath = new URL("./assets/models/face_landmarker.task", import.meta.url).href;
    const vision = await FilesetResolver.forVisionTasks(wasmPath);
    const options = {
      baseOptions: { modelAssetPath: modelPath, delegate: "GPU" },
      runningMode: "IMAGE",
      numFaces: 2,
      minFaceDetectionConfidence: 0.6,
      minFacePresenceConfidence: 0.6,
    };
    try {
      imageLandmarker = await FaceLandmarker.createFromOptions(vision, options);
    } catch {
      options.baseOptions.delegate = "CPU";
      imageLandmarker = await FaceLandmarker.createFromOptions(vision, options);
    }
    return imageLandmarker;
  })().catch((error) => {
    imageModelPromise = null;
    throw error;
  });
  return imageModelPromise;
}

async function prepareUploadedImage(file) {
  const bitmap = await createImageBitmap(file);
  const maximumSide = 1800;
  const scale = Math.min(1, maximumSide / Math.max(bitmap.width, bitmap.height));
  const workCanvas = document.createElement("canvas");
  workCanvas.width = Math.max(1, Math.round(bitmap.width * scale));
  workCanvas.height = Math.max(1, Math.round(bitmap.height * scale));
  workCanvas.getContext("2d").drawImage(bitmap, 0, 0, workCanvas.width, workCanvas.height);
  bitmap.close();
  return workCanvas;
}

async function analyzeUploadedPhoto(file) {
  setCameraError();
  if (!file) return;
  if (file.size > 12 * 1024 * 1024) {
    setCameraError("A foto ultrapassa o limite de 12 MB.");
    return;
  }
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
    setCameraError("Formato não suportado. Use JPG, PNG ou WEBP.");
    return;
  }

  const originalLabel = uploadAnalysisButton.innerHTML;
  let workCanvas = null;
  uploadAnalysisButton.disabled = true;
  uploadAnalysisButton.textContent = "[ ANALISANDO_LOCALMENTE... ]";
  instruction.textContent = "Lendo landmarks da foto...";
  scanDetail.textContent = "A imagem permanece neste dispositivo e não é adicionada ao relatório.";
  try {
    saveCameraPreferences({ presentationTarget: presentationTarget.value });
    workCanvas = await prepareUploadedImage(file);
    const landmarker = await initializeImageModel();
    const result = landmarker.detect(workCanvas);
    if (!result.faceLandmarks?.length) throw new Error("Nenhum rosto foi encontrado na foto.");
    if (result.faceLandmarks.length > 1) throw new Error("Use uma foto com apenas um rosto.");
    const analysis = analyzeLandmarks(result.faceLandmarks[0], {
      aspectRatio: workCanvas.width / workCanvas.height,
      sourceType: "consented_photo_upload",
      presentationTarget: presentationTarget.value,
      confidence: 72,
      imageSignals: analyzeImageSignals(workCanvas, result.faceLandmarks[0]),
    });
    storeOneTimeAnalysis(analysis);
    modelStatus.textContent = "MODEL_STATUS: PHOTO_ANALYSIS_READY";
    navigatingToReport = true;
    window.location.href = "resultado.html";
  } catch (error) {
    setCameraError(error.message || "Não foi possível analisar a foto.");
    modelStatus.textContent = "MODEL_STATUS: IMAGE_ERROR";
    uploadAnalysisButton.disabled = false;
    uploadAnalysisButton.innerHTML = originalLabel;
  } finally {
    analysisPhotoFile.value = "";
    wipeCanvas(workCanvas);
  }
}

async function refreshCameraList(preferredDeviceId = "") {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((device) => device.kind === "videoinput");
  const activeDeviceId =
    preferredDeviceId || currentStream?.getVideoTracks()[0]?.getSettings()?.deviceId || cameraSelect.value;

  cameraSelect.replaceChildren();
  if (!cameras.length) {
    const option = new Option("nenhuma câmera encontrada", "");
    cameraSelect.add(option);
    cameraSelect.disabled = true;
    return;
  }

  cameras.forEach((camera, index) => {
    const label = camera.label || `Câmera ${index + 1}`;
    cameraSelect.add(new Option(label, camera.deviceId));
  });
  cameraSelect.disabled = currentMode !== "camera";
  if (activeDeviceId && cameras.some((camera) => camera.deviceId === activeDeviceId)) {
    cameraSelect.value = activeDeviceId;
  }
}

function attachTrackEndedHandler(stream) {
  const track = stream.getVideoTracks()[0];
  if (!track) return;
  track.addEventListener("ended", () => {
    stopCurrentStream();
    cameraGate.hidden = false;
    faceLock.hidden = true;
    instructionIndex.textContent = "00";
    instruction.textContent = "A fonte de vídeo foi encerrada.";
    scanDetail.textContent = "Escolha uma câmera ou compartilhe novamente uma janela.";
  });
}

async function attachStream(stream, mode) {
  stopCurrentStream();
  currentStream = stream;
  currentMode = mode;
  video.srcObject = stream;
  await video.play();

  if (!video.videoWidth || !video.videoHeight) {
    await new Promise((resolve) => video.addEventListener("loadedmetadata", resolve, { once: true }));
  }

  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  canvas.width = width;
  canvas.height = height;
  stage.style.aspectRatio = `${width} / ${height}`;
  streamResolution.textContent = `${width} × ${height}`;
  streamLabel.textContent = stream.getVideoTracks()[0]?.label || (mode === "display" ? "SHARED_WINDOW" : "VIDEO_INPUT");
  cameraGate.hidden = true;
  faceLock.hidden = false;
  cameraSelect.disabled = mode !== "camera";
  if (mode === "camera") {
    const track = stream.getVideoTracks()[0];
    const identity = await currentCameraIdentity(track?.getSettings()?.deviceId || "", track?.label || "");
    saveCameraPreferences({
      ...identity,
      mirror: mirrorCamera.checked,
      autoStart: autoCamera.checked,
    });
  }
  attachTrackEndedHandler(stream);
  resetSequence();
  await initializeModel();
  startRenderLoop();
}

function cameraErrorMessage(error) {
  const messages = {
    NotAllowedError: "Permissão negada. Libere a câmera no ícone ao lado do endereço do site.",
    NotFoundError: "Nenhuma câmera compatível foi encontrada.",
    NotReadableError: "A câmera está sendo usada por outro programa. Feche-o e tente novamente.",
    OverconstrainedError: "A câmera não suporta a configuração solicitada.",
    SecurityError: "O navegador bloqueou a câmera por segurança. Use HTTPS ou localhost.",
    TypeError: "A câmera exige uma conexão HTTPS ou localhost.",
  };
  return messages[error?.name] || `Falha ao abrir a fonte de vídeo: ${error?.message || "erro desconhecido"}`;
}

async function useCamera(deviceId = "") {
  setCameraError();
  if (!navigator.mediaDevices?.getUserMedia) {
    setCameraError("Câmera indisponível neste endereço. Use HTTPS ou abra por http://localhost:8080 no computador.");
    return;
  }

  try {
    const videoConstraints = deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }
      : { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
    const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
    currentMode = "camera";
    await attachStream(stream, "camera");
    await refreshCameraList(stream.getVideoTracks()[0]?.getSettings()?.deviceId);
  } catch (error) {
    setCameraError(cameraErrorMessage(error));
    cameraGate.hidden = false;
  }
}

async function shareWindow() {
  setCameraError();
  if (!navigator.mediaDevices?.getDisplayMedia) {
    setCameraError("Compartilhamento de janela não é suportado neste navegador ou endereço.");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30 }, cursor: "never" },
      audio: false,
    });
    await attachStream(stream, "display");
    cameraSelect.replaceChildren(new Option("janela/tela compartilhada", "display", true, true));
    cameraSelect.disabled = true;
  } catch (error) {
    if (error?.name !== "AbortError") setCameraError(cameraErrorMessage(error));
  }
}

function sampleBrightness(now) {
  if (now - brightnessSampleAt < 500 || !video.videoWidth) return;
  brightnessSampleAt = now;
  qualityContext.drawImage(video, 0, 0, qualityCanvas.width, qualityCanvas.height);
  const pixels = qualityContext.getImageData(0, 0, qualityCanvas.width, qualityCanvas.height).data;
  let total = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    total += pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722;
  }
  brightness = total / (pixels.length / 4);
}

function evaluateQuality(landmarks) {
  if (!landmarks?.length) {
    return { face: false, size: false, center: false, light: brightness > 48 && brightness < 225 };
  }

  let minX = 1;
  let maxX = 0;
  let minY = 1;
  let maxY = 0;
  landmarks.forEach((point) => {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  });
  const width = maxX - minX;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return {
    face: true,
    size: width > 0.27 && width < 0.78,
    center: Math.abs(centerX - 0.5) < 0.13 && Math.abs(centerY - 0.5) < 0.17,
    light: brightness > 48 && brightness < 225,
  };
}

function updateQualityPanel(quality) {
  let score = 0;
  Object.entries(qualityElements).forEach(([key, element]) => {
    const good = Boolean(quality[key]);
    element.classList.toggle("is-good", good);
    element.querySelector("b").textContent = good ? "PASS" : "WAIT";
    if (good) score += 1;
  });
  get("#quality-score").textContent = `${score}/4`;
  faceLockValue.textContent = quality.face ? `${score}/4 LOCKED` : "SEARCHING";
}

function drawMesh(landmarks) {
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!landmarks || !drawingUtils) return;

  drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, {
    color: GREEN_FAINT,
    lineWidth: 0.55,
  });
  [
    FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
    FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
    FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
    FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
    FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
    FaceLandmarker.FACE_LANDMARKS_LIPS,
    FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS,
    FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS,
  ].forEach((connectors) => {
    drawingUtils.drawConnectors(landmarks, connectors, { color: GREEN, lineWidth: 1.25 });
  });

  const importantPoints = [1, 10, 33, 61, 133, 152, 199, 234, 263, 291, 362, 454, 468, 473];
  context.fillStyle = GREEN;
  importantPoints.forEach((index) => {
    const point = landmarks[index];
    if (!point) return;
    context.beginPath();
    context.arc(point.x * canvas.width, point.y * canvas.height, 2.4, 0, Math.PI * 2);
    context.fill();
  });
}

function blendshapeNeutrality(result) {
  const categories = result?.faceBlendshapes?.[0]?.categories || [];
  const expressive = new Set([
    "jawOpen", "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft", "mouthFrownRight",
    "mouthPucker", "mouthFunnel", "mouthPressLeft", "mouthPressRight", "browInnerUp",
    "browDownLeft", "browDownRight", "cheekSquintLeft", "cheekSquintRight",
  ]);
  const peak = categories.reduce((highest, item) => expressive.has(item.categoryName)
    ? Math.max(highest, item.score || 0) : highest, 0);
  return Math.max(0, Math.min(100, (1 - peak) * 100));
}

function transformationMatrix(result) {
  const matrix = result?.facialTransformationMatrixes?.[0];
  const values = matrix?.data || matrix;
  if (!values || typeof values.length !== "number") return null;
  return Array.from(values).slice(0, 16).map((value) => Number(Number(value).toFixed(6)));
}

function aggregateVisualSignals(samples) {
  if (!samples.length) return null;
  const keys = [
    "skinHomogeneity", "facialContrast", "luminanceContrast", "colorContrastDeltaE",
    "eyeContrast", "browContrast", "mouthContrast", "contrastConfidence",
    "lightingUniformity", "brightness",
  ];
  const aggregate = { status: "multi_frame_pixel_proxy", sampleCount: samples.length };
  keys.forEach((key) => {
    const values = samples.map((sample) => sample[key]).filter(Number.isFinite).sort((a, b) => a - b);
    if (!values.length) return;
    const middle = Math.floor(values.length / 2);
    aggregate[key] = values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  });
  return aggregate;
}

function captureLandmarkSample(landmarks, now, result) {
  if (now - lastSampleAt < 250 || sessionSamples.length >= 100) return;
  lastSampleAt = now;
  sessionSamples.push({
    step: stepIndex,
    at: Math.round(now),
    landmarks: landmarks.map((point) => [
      Number(point.x.toFixed(5)),
      Number(point.y.toFixed(5)),
      Number(point.z.toFixed(5)),
    ]),
    expressionNeutrality: Number(blendshapeNeutrality(result).toFixed(2)),
    transformationMatrix: transformationMatrix(result),
  });
  if (stepIndex === 0 && now - lastVisualSignalAt >= 650 && frontVisualSignalSamples.length < 5 && video.videoWidth && video.videoHeight) {
    lastVisualSignalAt = now;
    const snapshot = document.createElement("canvas");
    const scale = Math.min(1, 720 / video.videoWidth);
    snapshot.width = Math.max(1, Math.round(video.videoWidth * scale));
    snapshot.height = Math.max(1, Math.round(video.videoHeight * scale));
    snapshot.getContext("2d").drawImage(video, 0, 0, snapshot.width, snapshot.height);
    frontVisualSignalSamples.push(analyzeImageSignals(snapshot, landmarks));
    frontVisualSignals = aggregateVisualSignals(frontVisualSignalSamples);
    wipeCanvas(snapshot);
  }
}

function poseProgressReady(landmarks) {
  if (!landmarks?.length) return false;
  const faceWidth = Math.max(Math.abs(landmarks[454].x - landmarks[234].x), 0.0001);
  const faceMidX = (landmarks[234].x + landmarks[454].x) / 2;
  const yaw = (landmarks[1].x - faceMidX) / faceWidth;
  const eyeY = (landmarks[33].y + landmarks[133].y + landmarks[263].y + landmarks[362].y) / 4;
  const pitch = (landmarks[1].y - eyeY) / Math.max(Math.abs(landmarks[152].y - eyeY), 0.0001);
  if (stepIndex === 0) {
    referencePitch = referencePitch === null ? pitch : referencePitch * 0.85 + pitch * 0.15;
    return Math.abs(yaw) < 0.055;
  }
  if (stepIndex === 1) {
    if (Math.abs(yaw) < 0.035) return false;
    firstYawDirection ||= Math.sign(yaw);
    return true;
  }
  if (stepIndex === 2) return Math.abs(yaw) >= 0.035 && Math.sign(yaw) === -firstYawDirection;
  const pitchDelta = pitch - (referencePitch ?? pitch);
  if (stepIndex === 3) {
    if (Math.abs(pitchDelta) < 0.014) return false;
    firstPitchDirection ||= Math.sign(pitchDelta);
    return true;
  }
  if (stepIndex === 4) return Math.abs(pitchDelta) >= 0.014 && Math.sign(pitchDelta) === -firstPitchDirection;
  return true;
}

function advanceSequence(quality, landmarks, now, result) {
  if (scanComplete || !faceLandmarker) return;
  const delta = Math.min(100, Math.max(0, now - previousTick));
  previousTick = now;
  const activeStep = steps[stepIndex];
  const poseReady = poseProgressReady(landmarks);
  const canAdvance = quality.face && quality.size && quality.light && poseReady && (!activeStep.requireCenter || quality.center);

  if (canAdvance) {
    stepElapsed += delta;
    captureLandmarkSample(landmarks, now, result);
  }

  const finishedDuration = steps.slice(0, stepIndex).reduce((total, step) => total + step.duration, 0);
  const totalDuration = steps.reduce((total, step) => total + step.duration, 0);
  updateProgress(((finishedDuration + stepElapsed) / totalDuration) * 100);

  if (stepElapsed >= activeStep.duration) {
    stepIndex += 1;
    stepElapsed = 0;
    if (stepIndex >= steps.length) {
      scanComplete = true;
      updateProgress(100);
      try {
        const analysis = analyzeLandmarkSamples(sessionSamples, {
          aspectRatio: (video.videoWidth || 1) / (video.videoHeight || 1),
          sourceType: currentMode === "display" ? "shared_window" : "guided_camera_scan",
          presentationTarget: presentationTarget.value,
          imageSignals: frontVisualSignals,
        });
        storeOneTimeAnalysis(analysis);
        sessionSamples.fill(null);
        sessionSamples.length = 0;
        frontVisualSignals = null;
        frontVisualSignalSamples.fill(null);
        frontVisualSignalSamples.length = 0;
        viewResultsButton.hidden = false;
      } catch (error) {
        setCameraError(`A captura terminou, mas o relatório falhou: ${error.message}`);
      }
    }
    updateInstruction();
  }
}

function updateFps(now) {
  fpsFrames += 1;
  if (now - fpsSampleAt < 1000) return;
  const fps = Math.round((fpsFrames * 1000) / Math.max(1, now - fpsSampleAt));
  fpsLabel.textContent = `${fps} FPS`;
  fpsFrames = 0;
  fpsSampleAt = now;
}

function renderFrame(now) {
  if (!currentStream || scannerModal.open === false) return;
  sampleBrightness(now);

  if (faceLandmarker && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = faceLandmarker.detectForVideo(video, now);
    const landmarks = result.faceLandmarks?.[0] || null;
    const quality = evaluateQuality(landmarks);
    drawMesh(landmarks);
    updateQualityPanel(quality);
    advanceSequence(quality, landmarks, now, result);
    updateFps(now);
    lastFrameAt = now;
  } else if (now - lastFrameAt > 700) {
    updateQualityPanel({ face: false, size: false, center: false, light: false });
  }

  animationFrame = window.requestAnimationFrame(renderFrame);
}

function startRenderLoop() {
  window.cancelAnimationFrame(animationFrame);
  previousTick = performance.now();
  fpsSampleAt = previousTick;
  fpsFrames = 0;
  animationFrame = window.requestAnimationFrame(renderFrame);
}

async function openScanner() {
  const preferences = readCameraPreferences();
  mirrorCamera.checked = preferences.mirror !== false;
  autoCamera.checked = Boolean(preferences.autoStart);
  presentationTarget.value = ["masculine", "feminine", "neutral"].includes(preferences.presentationTarget)
    ? preferences.presentationTarget : "neutral";
  stage.classList.toggle("is-mirrored", mirrorCamera.checked);
  permissionEnvironmentMessage();
  setCameraError(window.isSecureContext ? "" : cameraError.textContent);
  cameraGate.hidden = false;
  scannerModal.showModal();

  if (window.isSecureContext && preferences.autoStart && navigator.permissions?.query) {
    try {
      const permission = await navigator.permissions.query({ name: "camera" });
      if (permission.state === "granted") {
        await useCamera(await resolvePreferredDeviceId(preferences));
      }
    } catch {
      // Safari e alguns navegadores não expõem a permissão de câmera nesta API.
    }
  }
}

function closeScanner() {
  stopCurrentStream();
  discardCapturedBiometrics({ closeModels: true });
  scannerModal.close();
  faceLock.hidden = true;
  cameraGate.hidden = false;
}

get("#allow-camera").addEventListener("click", () => useCamera(cameraSelect.value));
get("#share-screen").addEventListener("click", shareWindow);
uploadAnalysisButton.addEventListener("click", () => analysisPhotoFile.click());
analysisPhotoFile.addEventListener("change", () => analyzeUploadedPhoto(analysisPhotoFile.files?.[0]));
get("#refresh-cameras").addEventListener("click", () => refreshCameraList());
get("#close-scanner").addEventListener("click", closeScanner);
restartButton.addEventListener("click", resetSequence);
viewResultsButton.addEventListener("click", () => {
  navigatingToReport = true;
  discardCapturedBiometrics({ preserveTransfer: true });
  window.location.href = "resultado.html";
});
cameraSelect.addEventListener("change", () => {
  if (cameraSelect.value && currentMode === "camera") {
    currentCameraIdentity(cameraSelect.value, cameraSelect.selectedOptions[0]?.textContent || "").then(saveCameraPreferences);
    useCamera(cameraSelect.value);
  }
});
mirrorCamera.addEventListener("change", () => {
  stage.classList.toggle("is-mirrored", mirrorCamera.checked);
  saveCameraPreferences({ mirror: mirrorCamera.checked });
});
autoCamera.addEventListener("change", () => {
  saveCameraPreferences({ autoStart: autoCamera.checked });
});
presentationTarget.addEventListener("change", () => {
  saveCameraPreferences({ presentationTarget: presentationTarget.value });
});
stage.classList.toggle("is-mirrored", mirrorCamera.checked);
scannerModal.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeScanner();
});

if (navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener("devicechange", () => refreshCameraList());
}

window.addEventListener("lokx:open-scanner", openScanner);
window.addEventListener("pagehide", () => {
  stopCurrentStream();
  discardCapturedBiometrics({ preserveTransfer: navigatingToReport, closeModels: true });
});
