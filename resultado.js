import { FaceLandmarker, FilesetResolver } from "./assets/mediapipe/vision_bundle.mjs";
import { analyzeImageSignals, analyzeLandmarks } from "./analysis-engine.js";

const get = (selector) => document.querySelector(selector);
const ANALYSIS_TRANSFER_KEY = "lokx_analysis_result_v1";
const REPORT_LIFETIME_MS = 15 * 60 * 1000;
const HIDDEN_LIFETIME_MS = 5 * 60 * 1000;

let primaryAnalysis = null;
let versusFile = null;
let imageLandmarker = null;
let modelPromise = null;
let originalDocumentTitle = document.title;
let reportExpiryTimer = 0;
let hiddenExpiryTimer = 0;
let reportDestroyed = false;

const targetLabels = {
  masculine: "MASCULINE CUES / PISTAS MASCULINAS",
  feminine: "FEMININE CUES / PISTAS FEMININAS",
  neutral: "NEUTRAL / DEFINIÇÃO MORFOLÓGICA",
};

const haircutDirections = {
  oval: [
    ["Side Part / Partição lateral", "Mantém o equilíbrio sem alongar demais o contorno."],
    ["Textured Crop / Crop texturizado", "Adiciona definição sem esconder totalmente a testa."],
    ["Medium Layers / Camadas médias", "Acompanha a proporção versátil do rosto oval."],
  ],
  square: [
    ["Textured Top / Topo texturizado", "Contrasta com linhas mandibulares mais retas."],
    ["Low Fade / Degradê baixo", "Preserva estrutura lateral sem ampliar excessivamente o maxilar."],
    ["Soft Side Part / Lateral suave", "Quebra ângulos rígidos com movimento assimétrico."],
  ],
  round: [
    ["Top Volume / Volume no topo", "Cria uma leitura visual mais vertical."],
    ["Controlled Sides / Laterais controladas", "Evita ampliar o ponto mais largo do rosto."],
    ["Diagonal Fringe / Franja diagonal", "Acrescenta linha e direção ao contorno."],
  ],
  oblong: [
    ["Textured Fringe / Franja texturizada", "Reduz visualmente a continuidade vertical da testa."],
    ["Side Layers / Camadas laterais", "Distribui volume para os lados."],
    ["Low Top Volume / Topo controlado", "Evita alongar ainda mais a silhueta."],
  ],
  heart: [
    ["Jaw-Length Layers / Camadas na mandíbula", "Equilibra testa e terço inferior."],
    ["Light Fringe / Franja leve", "Suaviza a largura aparente da região superior."],
    ["Medium Texture / Textura média", "Adiciona movimento sem concentrar volume só no topo."],
  ],
  diamond: [
    ["Textured Fringe / Franja texturizada", "Equilibra maçãs do rosto visualmente mais largas."],
    ["Side Part / Partição lateral", "Cria assimetria controlada na região superior."],
    ["Soft Side Volume / Volume lateral leve", "Conecta testa e mandíbula sem esconder o contorno."],
  ],
};

function setBar(selector, value) {
  get(selector).style.width = `${Math.max(0, Math.min(100, value))}%`;
}

function sourceClass(trait) {
  if (trait.scorePercent === null || trait.source === "not_measured") return "is-unsupported";
  if (trait.source?.includes("proxy") || ["contour_classification"].includes(trait.source)) return "is-proxy";
  return "is-measured";
}

function renderComponents(analysis) {
  const container = get("#psl-components");
  container.replaceChildren();
  analysis.psl.components.forEach((component) => {
    const card = document.createElement("article");
    const measured = component.scorePercent !== null;
    card.className = measured ? "psl-component" : "psl-component is-unmeasured";
    card.innerHTML = `
      <header><span>${component.weight}%</span><b>${component.termEn}</b></header>
      <p>${component.termPt}</p>
      <div><strong>${measured ? `${component.scorePercent}%` : "N/A"}</strong><small>${measured ? `PSL ${component.psl}/8` : "NOT_SCORED"}</small></div>
      <div class="score-track"><i style="width:${component.scorePercent ?? 0}%"></i></div>
      <em>${component.basis}</em>
    `;
    container.append(card);
  });
}

function renderModeAnalysis(analysis) {
  const descriptions = {
    masculine: "Masculine mode / modo masculino: enfatiza jawline, chin, eye framing, brow area, dimorfismo e angularidade.",
    feminine: "Feminine mode / modo feminino: enfatiza harmonia, suavidade, olhos, lábios, simetria e equilíbrio do lower third.",
    neutral: "Neutral/editorial mode / modo neutro: combina harmonia, proporções, fotogenia, distintividade e impacto sem favorecer dimorfismo.",
  };
  get("#mode-analysis-description").textContent = descriptions[analysis.modeAnalysis.id] || descriptions.neutral;
  const classifications = get("#mode-classifications");
  classifications.replaceChildren();
  analysis.modeAnalysis.classifications.forEach((item, index) => {
    const article = document.createElement("article");
    article.className = item.confidence === "unsupported" ? "mode-classification is-unsupported" : "mode-classification";
    article.innerHTML = `
      <span>${String(index + 1).padStart(2, "0")} // ${item.confidence.toUpperCase()}</span>
      <strong>${item.termEn}</strong><h3>${item.termPt}</h3>
      <b>${item.valueEn}</b><em>${item.valuePt}</em>
      ${item.note ? `<p>${item.note}</p>` : ""}
    `;
    classifications.append(article);
  });

  get("#applied-penalty-total").textContent = `−${analysis.psl.penalty.toFixed(2)} PSL`;
  const penalties = get("#penalty-list");
  penalties.replaceChildren();
  analysis.modeAnalysis.penalties.forEach((item) => {
    const row = document.createElement("article");
    row.className = `penalty-item is-${item.status}`;
    const status = item.status === "applied" ? `−${item.points.toFixed(2)} PSL`
      : item.status === "clear" ? "CLEAR" : item.status.toUpperCase();
    row.innerHTML = `
      <div><strong>${item.labelEn}</strong><span>${item.labelPt}</span></div>
      <b>${status}</b>${item.note ? `<p>${item.note}</p>` : ""}
    `;
    penalties.append(row);
  });
}

function renderTraits(analysis) {
  const grid = get("#traits-grid");
  grid.replaceChildren();
  analysis.traits.forEach((trait, index) => {
    const card = document.createElement("article");
    card.className = `trait-card ${sourceClass(trait)}`;
    const score = trait.scorePercent === null ? "N/A" : `${trait.scorePercent}%`;
    const psl = trait.psl === null ? "NOT_SCORED" : `PSL ${trait.psl}/8`;
    const raw = trait.rawValue === null ? "--" : `${trait.rawValue}${trait.unit && !String(trait.rawValue).includes("/") ? ` ${trait.unit}` : ""}`;
    card.innerHTML = `
      <header><span>${String(index + 1).padStart(2, "0")}</span><i>${trait.confidence.toUpperCase()}</i></header>
      <h3>${trait.termEn}</h3>
      <h4>${trait.termPt}</h4>
      <div class="trait-scores"><strong>${score}</strong><b>${psl}</b></div>
      <div class="score-track"><i style="width:${trait.scorePercent ?? 0}%"></i></div>
      <dl><dt>RAW / VALOR</dt><dd>${raw}</dd><dt>VERDICT</dt><dd>${trait.verdict.en}<br /><span>${trait.verdict.pt}</span></dd></dl>
      ${trait.note ? `<p>${trait.note}</p>` : ""}
    `;
    grid.append(card);
  });
}

function renderAttractionDrivers(analysis) {
  const container = get("#attraction-drivers");
  container.replaceChildren();
  analysis.attractionDrivers.forEach((driver) => {
    const article = document.createElement("article");
    article.className = driver.rank === 1 ? "attraction-driver is-primary" : "attraction-driver";
    article.innerHTML = `
      <span>#0${driver.rank} CONTRIBUTOR</span>
      <strong>${driver.termEn}</strong>
      <h3>${driver.termPt}</h3>
      <div><b>${driver.score}%</b><i style="width:${driver.score}%"></i></div>
      <p>${driver.explanation}</p>
      <small>${driver.evidence}</small>
    `;
    container.append(article);
  });
}

function renderPotential(analysis) {
  const primary = analysis.potential[0];
  get("#greatest-potential").textContent = `${primary.termEn} / ${primary.termPt}`;
  get("#greatest-potential-action").textContent = primary.action;

  const container = get("#potential-list");
  container.replaceChildren();
  analysis.potential.forEach((item) => {
    const article = document.createElement("article");
    article.className = "potential-item";
    article.innerHTML = `
      <span>PRIORITY_0${item.priority}</span>
      <strong>${item.termEn}</strong>
      <h3>${item.termPt}</h3>
      <b>${item.opportunityPercent}% OPPORTUNITY / OPORTUNIDADE</b>
      <p>${item.action}</p>
      <small>${item.safety}</small>
    `;
    container.append(article);
  });

  const hairList = get("#hair-list");
  hairList.replaceChildren();
  const directions = haircutDirections[analysis.faceShape.id] || haircutDirections.oval;
  directions.forEach(([title, description], index) => {
    const article = document.createElement("article");
    article.className = "hair-item";
    article.innerHTML = `<span>0${index + 1}</span><strong>${title}</strong><p>${description}</p>`;
    hairList.append(article);
  });
}

function renderTierContext(analysis) {
  const tier = analysis.psl.tier;
  const calibration = analysis.psl.calibration || {};
  get("#tier-band-detail").textContent = `${tier.label} // ${tier.translation}`;
  get("#tier-range-detail").textContent = `PSL BAND ${tier.range} // SUBLEVEL ${tier.sublevel || "--"}`;
  const gateText = calibration.gateReasons?.length
    ? `GATE_APPLIED: ${calibration.gateReasons.join("; ")}`
    : "GATE_STATUS: CLEAR // requisitos mínimos do tier atendidos";
  get("#tier-calibration-detail").textContent = `WEIGHTED ${calibration.weightedPercent ?? "--"}% // CORE_MIN ${calibration.weakestCoreComponent ?? "--"}% → BASE PSL ${calibration.calibratedBasePsl ?? "--"} → FINAL ${analysis.psl.score.toFixed(2)}. ${gateText}`;
  const references = get("#tier-reference-list");
  references.replaceChildren();
  if (!tier.references?.length) {
    const empty = document.createElement("b");
    empty.textContent = "SEM_REFERÊNCIAS_CONFIÁVEIS_PARA_ESTA_FAIXA";
    references.append(empty);
    return;
  }
  tier.references.forEach((name) => {
    const item = document.createElement("b");
    item.textContent = name;
    references.append(item);
  });
}

function renderDimensionAudit(analysis) {
  const audit = analysis.dimensionAudit;
  if (!audit) return;
  get("#dimension-2d-status").textContent = `${audit.twoDimensional.status.toUpperCase()} // ${Math.round(audit.twoDimensional.confidence)}%`;
  get("#dimension-2d-detail").textContent = audit.twoDimensional.basis;
  get("#dimension-3d-status").textContent = `${audit.depthProxy.status.toUpperCase()} // ${Math.round(audit.depthProxy.confidence)}%`;
  get("#dimension-3d-detail").textContent = `${audit.depthProxy.source} // ${audit.depthProxy.transformationMatrixSamples || 0} matrizes de transformação`;
  get("#dimension-pose-score").textContent = `${Math.round(audit.depthProxy.poseCoverage)}%`;
  get("#dimension-pose-detail").textContent = `${audit.depthProxy.completedSteps}/5 poses // yaw span ${audit.depthProxy.yawSpan} // pitch span ${audit.depthProxy.pitchSpan}`;
  get("#dimension-limit-detail").textContent = audit.limitation;
}

function renderPrimary(analysis) {
  get("#psl-score").textContent = analysis.psl.score.toFixed(2);
  get("#tier-name").textContent = analysis.psl.tier.label;
  get("#tier-translation").textContent = analysis.psl.tier.translation;
  get("#rating-profile").textContent = `PROFILE: ${targetLabels[analysis.presentationTarget] || targetLabels.neutral}`;
  get("#psl-formula").textContent = analysis.psl.formula;
  get("#psl-penalty").textContent = `CAPTURE_PENALTY: −${analysis.psl.penalty.toFixed(2)} PSL`;
  get("#face-shape").textContent = analysis.faceShape.label;
  get("#geometry-index").textContent = Math.round(analysis.scores.geometryIndex);
  get("#confidence-score").textContent = Math.round(analysis.scores.captureConfidence);
  setBar("#geometry-bar", analysis.scores.geometryIndex);
  setBar("#confidence-bar", analysis.scores.captureConfidence);
  const strongest = analysis.attractionDrivers[0];
  get("#strongest-trait").textContent = strongest.termEn;
  get("#strongest-trait-pt").textContent = strongest.termPt;
  renderComponents(analysis);
  renderTierContext(analysis);
  renderDimensionAudit(analysis);
  renderModeAnalysis(analysis);
  renderTraits(analysis);
  renderAttractionDrivers(analysis);
  renderPotential(analysis);
}

function initializePage() {
  let serializedAnalysis = null;
  try {
    serializedAnalysis = sessionStorage.getItem(ANALYSIS_TRANSFER_KEY);
    sessionStorage.removeItem(ANALYSIS_TRANSFER_KEY);
    const transfer = serializedAnalysis ? JSON.parse(serializedAnalysis) : null;
    const validTransfer = transfer?.kind === "lokx-one-time-analysis"
      && Number.isFinite(transfer.expiresAt)
      && Date.now() <= transfer.expiresAt;
    primaryAnalysis = validTransfer ? transfer.payload : null;
  } catch {
    primaryAnalysis = null;
  } finally {
    serializedAnalysis = null;
    sessionStorage.removeItem(ANALYSIS_TRANSFER_KEY);
  }

  if (!primaryAnalysis?.psl || !primaryAnalysis.modeAnalysis || primaryAnalysis.version < 3) {
    get("#empty-report").hidden = false;
    get("#download-pdf").disabled = true;
    get("#download-pdf-footer").disabled = true;
    return;
  }
  get("#report-content").hidden = false;
  get("#print-report-date").textContent = `GENERATED LOCALLY / GERADO LOCALMENTE // ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "short" }).format(new Date())}`;
  renderPrimary(primaryAnalysis);
  reportExpiryTimer = window.setTimeout(() => destroySensitiveReport({ navigate: true }), REPORT_LIFETIME_MS);
}

function clearVersusFile() {
  versusFile = null;
  const input = get("#versus-file");
  if (input) input.value = "";
  const label = get(".upload-zone strong");
  if (label) label.textContent = "ANEXAR_FOTO_B";
}

function destroySensitiveReport({ scrubDom = true, navigate = false } = {}) {
  if (reportDestroyed && !navigate) return;
  reportDestroyed = true;
  window.clearTimeout(reportExpiryTimer);
  window.clearTimeout(hiddenExpiryTimer);
  sessionStorage.removeItem(ANALYSIS_TRANSFER_KEY);
  clearVersusFile();
  primaryAnalysis = null;
  try { imageLandmarker?.close(); } catch {}
  imageLandmarker = null;
  modelPromise = null;
  if (scrubDom) {
    const content = get("#report-content");
    content?.replaceChildren();
    if (content) content.hidden = true;
  }
  if (navigate) window.location.replace("index.html?report=deleted");
}

function downloadReportPdf() {
  if (!primaryAnalysis) return;
  const date = new Date().toISOString().slice(0, 10);
  originalDocumentTitle = document.title;
  document.title = `LOKX_PSL_Report_${date}`;
  document.documentElement.classList.add("is-printing-report");
  window.setTimeout(() => window.print(), 60);
}

function finishPdfExport() {
  document.documentElement.classList.remove("is-printing-report");
  document.title = originalDocumentTitle;
}

async function initializeImageModel() {
  if (imageLandmarker) return imageLandmarker;
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
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
  })();
  return modelPromise;
}

function updateUploadButton() {
  get("#analyze-versus").disabled = !(versusFile && get("#versus-consent").checked);
}

async function prepareImage(file) {
  const bitmap = await createImageBitmap(file);
  const maximumSide = 1600;
  const scale = Math.min(1, maximumSide / Math.max(bitmap.width, bitmap.height));
  const workCanvas = document.createElement("canvas");
  workCanvas.width = Math.max(1, Math.round(bitmap.width * scale));
  workCanvas.height = Math.max(1, Math.round(bitmap.height * scale));
  workCanvas.getContext("2d").drawImage(bitmap, 0, 0, workCanvas.width, workCanvas.height);
  bitmap.close();
  return workCanvas;
}

function renderVersus(challenger) {
  get("#versus-primary-score").textContent = primaryAnalysis.psl.score.toFixed(2);
  get("#versus-primary-tier").textContent = primaryAnalysis.psl.tier.label;
  get("#versus-primary-tier-pt").textContent = primaryAnalysis.psl.tier.translation;
  get("#versus-photo-score").textContent = challenger.psl.score.toFixed(2);
  get("#versus-photo-tier").textContent = challenger.psl.tier.label;
  get("#versus-photo-tier-pt").textContent = challenger.psl.tier.translation;
  get("#versus-result").hidden = false;
  get("#versus-result").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function analyzeVersusPhoto() {
  const button = get("#analyze-versus");
  const errorElement = get("#versus-error");
  errorElement.textContent = "";
  if (!versusFile || !get("#versus-consent").checked) return;
  if (versusFile.size > 12 * 1024 * 1024) {
    errorElement.textContent = "A foto ultrapassa o limite de 12 MB.";
    return;
  }

  button.disabled = true;
  button.textContent = "[ CARREGANDO_MODELO_LOCAL... ]";
  let workCanvas = null;
  try {
    workCanvas = await prepareImage(versusFile);
    const landmarker = await initializeImageModel();
    const result = landmarker.detect(workCanvas);
    if (!result.faceLandmarks?.length) throw new Error("Nenhum rosto foi encontrado na foto.");
    if (result.faceLandmarks.length > 1) throw new Error("Use uma foto com apenas um rosto.");
    const landmarks = result.faceLandmarks[0];
    const challenger = analyzeLandmarks(landmarks, {
      aspectRatio: workCanvas.width / workCanvas.height,
      sourceType: "consented_photo",
      presentationTarget: primaryAnalysis.presentationTarget,
      confidence: 70,
      imageSignals: analyzeImageSignals(workCanvas, landmarks),
    });
    renderVersus(challenger);
  } catch (error) {
    errorElement.textContent = error.message || "Não foi possível analisar a foto.";
  } finally {
    workCanvas?.getContext("2d")?.clearRect(0, 0, workCanvas.width, workCanvas.height);
    if (workCanvas) { workCanvas.width = 1; workCanvas.height = 1; }
    clearVersusFile();
    button.textContent = "[ ANALISAR_E_COMPARAR ]";
    updateUploadButton();
  }
}

get("#versus-file").addEventListener("change", (event) => {
  versusFile = event.target.files?.[0] || null;
  get(".upload-zone strong").textContent = versusFile ? "FOTO_B_PRONTA // NOME_OCULTO" : "ANEXAR_FOTO_B";
  get("#versus-result").hidden = true;
  updateUploadButton();
});
get("#versus-consent").addEventListener("change", updateUploadButton);
get("#analyze-versus").addEventListener("click", analyzeVersusPhoto);
get("#download-pdf").addEventListener("click", downloadReportPdf);
get("#download-pdf-footer").addEventListener("click", downloadReportPdf);
get("#destroy-report").addEventListener("click", () => destroySensitiveReport({ navigate: true }));
get("#destroy-report-footer").addEventListener("click", () => destroySensitiveReport({ navigate: true }));
window.addEventListener("afterprint", finishPdfExport);
window.addEventListener("pagehide", () => destroySensitiveReport({ scrubDom: true }));
window.addEventListener("pageshow", (event) => {
  if (event.persisted) window.location.replace("index.html?report=deleted");
});
document.addEventListener("visibilitychange", () => {
  window.clearTimeout(hiddenExpiryTimer);
  if (document.hidden && primaryAnalysis) {
    hiddenExpiryTimer = window.setTimeout(() => destroySensitiveReport({ navigate: true }), HIDDEN_LIFETIME_MS);
  }
});

initializePage();
