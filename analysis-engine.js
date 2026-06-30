const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, precision = 2) => Number(value.toFixed(precision));

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointDistance3d(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
}

function average(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : 0;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function toPoint(point, aspectRatio) {
  if (Array.isArray(point)) return { x: point[0] * aspectRatio, y: point[1], z: point[2] || 0 };
  return { x: point.x * aspectRatio, y: point.y, z: point.z || 0 };
}

function normalizedLandmarks(landmarks, aspectRatio) {
  return landmarks.map((point) => toPoint(point, aspectRatio));
}

function medianLandmarks(samples, aspectRatio) {
  const usable = samples.filter((sample) => sample?.landmarks?.length >= 478);
  if (!usable.length) return null;
  return Array.from({ length: 478 }, (_, index) => ({
    x: median(usable.map((sample) => sample.landmarks[index][0])) * aspectRatio,
    y: median(usable.map((sample) => sample.landmarks[index][1])),
    z: median(usable.map((sample) => sample.landmarks[index][2] || 0)),
  }));
}

function poseFromLandmarks(points) {
  const faceWidth = pointDistance(points[234], points[454]);
  const faceMidX = (points[234].x + points[454].x) / 2;
  const eyeY = average([points[33].y, points[133].y, points[263].y, points[362].y]);
  const eyeChinHeight = Math.max(Math.abs(points[152].y - eyeY), 0.0001);
  return {
    yaw: (points[1].x - faceMidX) / Math.max(faceWidth, 0.0001),
    pitch: (points[1].y - eyeY) / eyeChinHeight,
  };
}

function summarizeMultiView(samples, aspectRatio) {
  const groups = Array.from({ length: 6 }, (_, step) => samples.filter((sample) => sample.step === step));
  const poses = groups.map((group) => {
    const points = medianLandmarks(group, aspectRatio);
    return points ? poseFromLandmarks(points) : null;
  });
  const completedSteps = groups.filter((group) => group.length >= 2).length;
  const yawSpan = poses[1] && poses[2] ? Math.abs(poses[1].yaw - poses[2].yaw) : 0;
  const pitchSpan = poses[3] && poses[4] ? Math.abs(poses[3].pitch - poses[4].pitch) : 0;
  const stepCoverage = completedSteps / 6 * 100;
  const yawCoverage = clamp((yawSpan / 0.14) * 100, 0, 100);
  const pitchCoverage = clamp((pitchSpan / 0.11) * 100, 0, 100);
  const poseCoverage = average([stepCoverage, yawCoverage, pitchCoverage]);
  const expressionValues = samples.map((sample) => sample.expressionNeutrality).filter(Number.isFinite);
  const expressionNeutrality = expressionValues.length ? average(expressionValues) : null;
  const matrixSamples = samples.filter((sample) => Array.isArray(sample.transformationMatrix) && sample.transformationMatrix.length === 16).length;
  return {
    source: "guided_multiview_rgb_depth_proxy",
    completedSteps,
    sampleCount: samples.length,
    matrixSamples,
    poseCoverage: round(poseCoverage, 1),
    yawSpan: round(yawSpan * 100, 2),
    pitchSpan: round(pitchSpan * 100, 2),
    depthConfidence: round(clamp(35 + stepCoverage * 0.25 + yawCoverage * 0.16 + pitchCoverage * 0.12, 35, 88), 1),
    expressionNeutrality: Number.isFinite(expressionNeutrality) ? round(expressionNeutrality, 1) : null,
  };
}

function relativeDepthSignals(points, supplemental = {}) {
  const faceWidth = Math.max(pointDistance(points[234], points[454]), 0.0001);
  const faceHeight = Math.max(pointDistance(points[10], points[152]), 0.0001);
  const cheekPlaneZ = average([points[234].z, points[454].z]);
  const jawPlaneZ = average([points[172].z, points[397].z]);
  const eyeDepth = average([points[468]?.z, points[473]?.z].filter(Number.isFinite));
  const infraorbitalDepth = average([points[117].z, points[346].z]);
  const zValues = points.map((point) => point.z).filter(Number.isFinite);
  const zUsable = zValues.length >= 478 && standardDeviation(zValues) > 0.0001;
  const nasalProjection = Math.abs(points[1].z - cheekPlaneZ) / faceWidth * 100;
  const chinProjection = Math.abs(points[152].z - jawPlaneZ) / faceWidth * 100;
  const orbitalSupport = Math.abs(eyeDepth - infraorbitalDepth) / faceWidth * 100;
  const ramusSurfaceRatio = average([
    pointDistance3d(points[234], points[172]),
    pointDistance3d(points[454], points[397]),
  ]) / faceHeight * 100;
  const surfaceGonialAngle = average([
    angleAt3d(points[234], points[172], points[152]),
    angleAt3d(points[454], points[397], points[152]),
  ]);
  const singleViewConfidence = zUsable ? 42 : 0;
  return {
    source: supplemental.source || "single_view_model_relative_depth_proxy",
    zUsable,
    depthConfidence: supplemental.depthConfidence ?? singleViewConfidence,
    poseCoverage: supplemental.poseCoverage ?? 0,
    completedSteps: supplemental.completedSteps ?? 1,
    sampleCount: supplemental.sampleCount ?? 1,
    matrixSamples: supplemental.matrixSamples ?? 0,
    yawSpan: supplemental.yawSpan ?? 0,
    pitchSpan: supplemental.pitchSpan ?? 0,
    expressionNeutrality: supplemental.expressionNeutrality ?? null,
    neckSignal: supplemental.neckSignal || null,
    nasalProjection: round(nasalProjection, 2),
    chinProjection: round(chinProjection, 2),
    orbitalSupport: round(orbitalSupport, 2),
    ramusSurfaceRatio: round(ramusSurfaceRatio, 2),
    surfaceGonialAngle: round(surfaceGonialAngle, 2),
  };
}

function tiltAngle(inner, outer) {
  return Math.atan2(inner.y - outer.y, Math.abs(outer.x - inner.x)) * (180 / Math.PI);
}

function angleAt(a, center, c) {
  const first = Math.atan2(a.y - center.y, a.x - center.x);
  const second = Math.atan2(c.y - center.y, c.x - center.x);
  let degrees = Math.abs((first - second) * (180 / Math.PI));
  if (degrees > 180) degrees = 360 - degrees;
  return degrees;
}

function angleAt3d(a, center, c) {
  const first = { x: a.x - center.x, y: a.y - center.y, z: (a.z || 0) - (center.z || 0) };
  const second = { x: c.x - center.x, y: c.y - center.y, z: (c.z || 0) - (center.z || 0) };
  const dot = first.x * second.x + first.y * second.y + first.z * second.z;
  const magnitude = Math.max(pointDistance3d(a, center) * pointDistance3d(c, center), 0.000001);
  return Math.acos(clamp(dot / magnitude, -1, 1)) * (180 / Math.PI);
}

function rangeAlignment(value, min, max) {
  const midpoint = (min + max) / 2;
  const halfRange = Math.max((max - min) / 2, 0.001);
  return round(clamp(100 - (Math.abs(value - midpoint) / halfRange) * 26, 0, 100), 1);
}

function targetAlignment(value, target, tolerance) {
  return round(clamp(100 - (Math.abs(value - target) / Math.max(tolerance, 0.001)) * 28, 0, 100), 1);
}

function toPsl(scorePercent) {
  const anchors = [
    [0, 1], [20, 2.4], [35, 3.4], [50, 4.3], [60, 4.9],
    [68, 5.5], [76, 6], [85, 6.5], [92, 7], [97, 7.5], [100, 7.8],
  ];
  const score = clamp(scorePercent, 0, 100);
  for (let index = 1; index < anchors.length; index += 1) {
    const [rightScore, rightPsl] = anchors[index];
    const [leftScore, leftPsl] = anchors[index - 1];
    if (score <= rightScore) {
      const progress = (score - leftScore) / Math.max(rightScore - leftScore, 0.001);
      return round(leftPsl + progress * (rightPsl - leftPsl), 2);
    }
  }
  return 7.6;
}

function scoreLabel(score) {
  if (score >= 85) return { en: "Exceptional alignment", pt: "Alinhamento excepcional" };
  if (score >= 72) return { en: "Strong", pt: "Forte" };
  if (score >= 58) return { en: "Balanced", pt: "Equilibrado" };
  if (score >= 44) return { en: "Mixed", pt: "Misto" };
  return { en: "Low alignment", pt: "Baixo alinhamento" };
}

function targetLabelsForEngine(target) {
  return {
    masculine: "MASCULINE_CUES / PISTAS_MASCULINAS",
    feminine: "FEMININE_CUES / PISTAS_FEMININAS",
    neutral: "NEUTRAL_DEFINITION / DEFINIÇÃO_NEUTRA",
  }[target] || "NEUTRAL_DEFINITION / DEFINIÇÃO_NEUTRA";
}

function classifyFaceShape(lengthToWidth, jawToCheek, templeToCheek) {
  if (lengthToWidth >= 1.48) return { id: "oblong", label: "Oblong / Oblongo" };
  if (jawToCheek >= 0.9 && lengthToWidth <= 1.38) return { id: "square", label: "Square / Quadrado" };
  if (jawToCheek >= 0.84 && lengthToWidth <= 1.28) return { id: "round", label: "Round / Redondo" };
  if (jawToCheek <= 0.76 && templeToCheek >= 0.86) return { id: "heart", label: "Heart / Coração" };
  if (jawToCheek <= 0.8 && templeToCheek <= 0.88 && lengthToWidth >= 1.32) {
    return { id: "diamond", label: "Diamond / Diamante" };
  }
  return { id: "oval", label: "Oval / Oval" };
}

function symmetryScore(points, faceWidth) {
  const midline = median([points[10].x, points[1].x, points[152].x]);
  const pairs = [
    [33, 263], [133, 362], [61, 291], [98, 327], [234, 454], [172, 397],
    [54, 284], [93, 323], [132, 361], [159, 386], [145, 374],
  ];
  const errors = pairs.map(([leftIndex, rightIndex]) => {
    const left = points[leftIndex];
    const right = points[rightIndex];
    const horizontal = Math.abs(Math.abs(left.x - midline) - Math.abs(right.x - midline));
    const vertical = Math.abs(left.y - right.y) * 0.7;
    return (horizontal + vertical) / Math.max(faceWidth, 0.001);
  });
  return round(clamp(100 - median(errors) * 430, 0, 100), 1);
}

function bilateralEyeScore(leftTilt, rightTilt, leftAspect, rightAspect) {
  const tiltDifference = Math.abs(leftTilt - rightTilt);
  const aspectDifference = Math.abs(leftAspect - rightAspect);
  return round(clamp(100 - tiltDifference * 5 - aspectDifference * 16, 0, 100), 1);
}

function tierForPsl(psl, target = "neutral") {
  const bands = [
    { id: "foundation", min: 1, max: 3, code: "SUB-3" },
    { id: "low", min: 3, max: 4, code: "LTN" },
    { id: "mid", min: 4, max: 5, code: "MTN" },
    { id: "high", min: 5, max: 5.5, code: "HTN" },
    { id: "lite", min: 5.5, max: 6, code: target === "feminine" ? "STACYLITE" : target === "masculine" ? "CHADLITE" : "LITE" },
    { id: "elite", min: 6, max: 6.5, code: target === "feminine" ? "STACY" : target === "masculine" ? "CHAD" : "ELITE" },
    { id: "mythic", min: 6.5, max: 7, code: target === "feminine" ? "HIGH STACY" : target === "masculine" ? "GIGA CHAD" : "HIGH ELITE" },
    { id: "legend", min: 7, max: 7.5, code: target === "feminine" ? "EVELITE" : target === "masculine" ? "ADAMLITE" : "LEGEND" },
    { id: "apex", min: 7.5, max: 8.001, code: target === "feminine" ? "TRUE EVE" : target === "masculine" ? "TRUE ADAM" : "APEX" },
  ];
  const band = bands.find((item) => psl >= item.min && psl < item.max) || bands[0];
  const progress = clamp((psl - band.min) / Math.max(band.max - band.min, 0.001), 0, 0.999);
  const sublevel = progress < 1 / 3 ? "LOW" : progress < 2 / 3 ? "MID" : "HIGH";
  const aliases = {
    foundation: target === "feminine" ? "Very Low Tier / faixa muito baixa" : "Very Low Tier / faixa muito baixa",
    low: target === "feminine" ? "Low-Tier Becky / tier feminino baixo" : "Low-Tier Normie / normie de tier baixo",
    mid: target === "feminine" ? "Mid-Tier Becky / tier feminino médio" : "Mid-Tier Normie / normie de tier médio",
    high: target === "feminine" ? "High-Tier Becky / tier feminino alto" : "High-Tier Normie / normie de tier alto",
    lite: "Elite-entry band / entrada do tier de elite",
    elite: "Elite forum band / tier de elite de fórum",
    mythic: "Upper elite band / tier de elite superior",
    legend: "Legend band / tier lendário",
    apex: "Mythic apex / ápice mítico",
  };
  const forumReferencesByTarget = {
    masculine: {
      low: ["Michael Cera"], mid: ["Shia LaBeouf"], high: ["Timothée Chalamet"],
      lite: ["Cristiano Ronaldo", "Neymar", "Taylor Lautner"],
      elite: ["Zayn Malik", "Chris Hemsworth"], mythic: ["Henry Cavill"],
      legend: ["Alain Delon", "Francisco Lachowski"], apex: [], foundation: [],
    },
    feminine: {
      low: [], mid: [], high: ["Kendall Jenner"], lite: ["Kendall Jenner"],
      elite: ["Charlize Theron"], mythic: [], legend: [], apex: [], foundation: [],
    },
    neutral: {
      low: ["Michael Cera"], mid: ["Shia LaBeouf"], high: ["Timothée Chalamet", "Kendall Jenner"],
      lite: ["Cristiano Ronaldo", "Neymar", "Taylor Lautner", "Kendall Jenner"],
      elite: ["Zayn Malik", "Chris Hemsworth", "Charlize Theron"], mythic: ["Henry Cavill"],
      legend: ["Alain Delon", "Francisco Lachowski"], apex: [], foundation: [],
    },
  };
  const forumReferences = forumReferencesByTarget[target] || forumReferencesByTarget.neutral;
  return {
    id: band.id,
    code: band.code,
    sublevel,
    label: band.id === "foundation" ? band.code : `${sublevel} ${band.code}`,
    translation: aliases[band.id],
    range: `${band.min.toFixed(2)}–${Math.min(8, band.max - 0.01).toFixed(2)}`,
    references: forumReferences[band.id],
    referenceNote: "Broad-band forum examples only; not a facial match or verified score.",
    referenceSources: [
      "https://forum.looksmaxxing.com/threads/psl-ratings-men.91547/",
      "https://forum.looksmaxxing.com/threads/psl-levels.24879/",
    ],
    taxonomy: "forum-inspired / inspirado em fóruns",
  };
}

function trait({ id, en, pt, score, raw, unit = "", confidence = "medium", source = "community_proxy", note = "" }) {
  const hasScore = Number.isFinite(score);
  return {
    id,
    termEn: en,
    termPt: pt,
    scorePercent: hasScore ? round(score, 1) : null,
    psl: hasScore ? toPsl(score) : null,
    rawValue: raw ?? null,
    unit,
    verdict: hasScore ? scoreLabel(score) : { en: "Not measurable", pt: "Não mensurável" },
    confidence,
    source,
    note,
  };
}

function buildAttractionDrivers({ harmony, eyeArea, jawline, featureBalance }) {
  const candidates = [
    {
      id: "global_harmony", score: harmony,
      termEn: "Global Facial Harmony", termPt: "Harmonia facial global",
      explanation: "A consistência entre proporções tende a sustentar a leitura do rosto como um conjunto, sem depender de um único traço.",
      evidence: "research-supported construct / construto estudado",
    },
    {
      id: "eye_area", score: eyeArea,
      termEn: "Eye-Area Framing", termPt: "Enquadramento da área dos olhos",
      explanation: "Inclinação, equilíbrio bilateral e proporção da abertura ocular formam o principal sinal geométrico da região dos olhos.",
      evidence: "mixed: geometry + forum proxy / evidência mista",
    },
    {
      id: "lower_third", score: jawline,
      termEn: "Lower-Third Structure", termPt: "Estrutura do terço inferior",
      explanation: "A relação entre mandíbula, largura facial e queixo dá presença visual ao contorno inferior na captura frontal.",
      evidence: "2D structural proxy / proxy estrutural 2D",
    },
    {
      id: "feature_balance", score: featureBalance,
      termEn: "Feature Balance", termPt: "Equilíbrio de características",
      explanation: "Olhos, nariz, boca e lábios próximos às faixas internas do modelo reduzem contrastes proporcionais muito fortes.",
      evidence: "mixed anthropometry / antropometria mista",
    },
  ];
  return candidates.sort((a, b) => b.score - a.score).map((item, index) => ({ ...item, rank: index + 1, score: round(item.score, 1) }));
}

function buildPotential({ shape, eyeArea, jawline, featureBalance, captureConfidence }) {
  const opportunities = [
    {
      id: "hair_architecture", baseline: featureBalance,
      termEn: "Hair Architecture", termPt: "Arquitetura do cabelo",
      action: `Use o contorno ${shape.label} para testar volume, laterais e divisão sem tentar “corrigir” sua anatomia.`,
      safety: "softmaxxing / reversível",
    },
    {
      id: "eye_framing", baseline: eyeArea,
      termEn: "Eye Framing", termPt: "Enquadramento dos olhos",
      action: "Teste desenho de sobrancelha, cabelo afastado da área ocular e luz frontal uniforme; compare sempre com a mesma câmera.",
      safety: "grooming + apresentação",
    },
    {
      id: "lower_third_presentation", baseline: jawline,
      termEn: "Lower-Third Presentation", termPt: "Apresentação do terço inferior",
      action: "Barba, enquadramento, postura neutra e distância maior da lente podem revelar melhor o contorno sem prometer alteração óssea.",
      safety: "não invasivo",
    },
    {
      id: "capture_standardization", baseline: captureConfidence,
      termEn: "Capture Standardization", termPt: "Padronização da captura",
      action: "Repita fotos com lente sem grande-angular, cabeça nivelada, expressão neutra e luz difusa antes de comparar evolução.",
      safety: "melhora a confiabilidade",
    },
  ];
  return opportunities.sort((a, b) => a.baseline - b.baseline).map((item, index) => ({
    ...item,
    priority: index + 1,
    opportunityPercent: round(clamp(100 - item.baseline * 0.55, 18, 78), 1),
  }));
}

function standardDeviation(values) {
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function srgbChannelToLinear(value) {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function rgbToLab(red, green, blue) {
  const r = srgbChannelToLinear(red);
  const g = srgbChannelToLinear(green);
  const b = srgbChannelToLinear(blue);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const transform = (value) => value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  const fx = transform(x);
  const fy = transform(y);
  const fz = transform(z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

function adaptedMichelson(skin, feature) {
  return Math.abs((skin - feature) / Math.max(skin + feature, 0.001));
}

function level3(score) {
  if (score >= 70) return { en: "high", pt: "alta" };
  if (score >= 45) return { en: "moderate", pt: "moderada" };
  return { en: "low", pt: "baixa" };
}

function modeClassification(id, termEn, termPt, value, confidence = "medium", note = "") {
  return { id, termEn, termPt, valueEn: value.en, valuePt: value.pt, confidence, note };
}

function modeComponent(id, termEn, termPt, weight, scorePercent, basis) {
  return {
    id, termEn, termPt, weight,
    scorePercent: Number.isFinite(scorePercent) ? round(scorePercent, 1) : null,
    psl: Number.isFinite(scorePercent) ? toPsl(scorePercent) : null,
    basis,
  };
}

function weightedComponentScore(components) {
  const measured = components.filter((item) => Number.isFinite(item.scorePercent));
  const measuredWeight = measured.reduce((sum, item) => sum + item.weight, 0);
  return measuredWeight
    ? measured.reduce((sum, item) => sum + item.scorePercent * item.weight, 0) / measuredWeight
    : 0;
}

function penalty(id, labelEn, labelPt, status, points = 0, note = "") {
  // Component scores already contain most geometric weaknesses. Keep explicit
  // penalties small so the same signal is not counted a second time at full weight.
  const effectivePoints = status === "applied" ? points * 0.35 : 0;
  return { id, labelEn, labelPt, status, points: round(effectivePoints, 2), note };
}

function createModeAnalysis(mode, s) {
  const midfaceClass = s.middleThird < 30 ? { en: "short", pt: "curto" }
    : s.middleThird <= 36 ? { en: "balanced", pt: "equilibrado" } : { en: "long", pt: "longo" };
  const cheekboneClass = s.cheekboneScore >= 72 ? { en: "high / prominent", pt: "altas / proeminentes" }
    : s.cheekboneScore >= 46 ? { en: "medium", pt: "médias" } : { en: "low", pt: "baixas" };
  const capturePenalty = round((100 - s.captureConfidence) * 0.006, 2);
  const commonPenalties = [
    penalty("low_symmetry", "Low symmetry", "Baixa simetria", s.symmetry < 55 ? "applied" : "clear", s.symmetry < 55 ? 0.12 : 0),
    penalty("long_midface", "Very long midface", "Midface muito longo", s.middleThird > 38 ? "applied" : "clear", s.middleThird > 38 ? 0.1 : 0),
    penalty("capture_quality", "Capture quality", "Qualidade da captura", capturePenalty > 0.08 ? "applied" : "clear", capturePenalty, "Combina confiança, enquadramento e estabilidade; não identifica sozinho a causa."),
    penalty("lighting_uniformity", "Uneven lighting signal", "Sinal de iluminação desigual", Number.isFinite(s.lightingUniformity) ? (s.lightingUniformity < 45 ? "applied" : "clear") : "not_measured", Number.isFinite(s.lightingUniformity) && s.lightingUniformity < 45 ? 0.06 : 0, "Estimativa de pixels; sombras intencionais também podem afetar o valor."),
    penalty("expression_neutrality", "Expression neutrality", "Neutralidade da expressão", Number.isFinite(s.depthSignals?.expressionNeutrality) ? (s.depthSignals.expressionNeutrality < 68 ? "applied" : "clear") : "not_measured", Number.isFinite(s.depthSignals?.expressionNeutrality) && s.depthSignals.expressionNeutrality < 68 ? 0.08 : 0, "Blendshapes detectam sorriso, abertura da boca e contrações; não interpretam emoção."),
    penalty("multiview_coverage", "2D/3D pose coverage", "Cobertura de poses 2D/3D", s.depthSignals?.source === "guided_multiview_rgb_depth_proxy" ? (s.depthSignals.poseCoverage < 55 ? "applied" : "clear") : "not_measured", s.depthSignals?.source === "guided_multiview_rgb_depth_proxy" && s.depthSignals.poseCoverage < 55 ? 0.1 : 0, "A profundidade é relativa ao modelo; não é escaneamento métrico."),
  ];

  let components = [];
  let classifications = [];
  let penalties = [...commonPenalties];
  let formula = "";
  let drivers = [];

  if (mode === "masculine") {
    const masculineExtras = Number.isFinite(s.facialContrast)
      ? s.featureBalance * 0.9 + s.facialContrast * 0.1 : s.featureBalance;
    const jawClass = s.jawlineScore >= 82 ? { en: "angular", pt: "angular" }
      : s.jawlineScore >= 68 ? { en: "defined", pt: "definida" }
        : s.jawlineScore >= 53 ? { en: "moderate", pt: "moderada" }
          : s.jawlineScore >= 38 ? { en: "soft", pt: "suave" } : { en: "weak", pt: "fraca" };
    const chinClass = s.chinPhiltrumRatio < 1.75 ? { en: "recessed-like visual", pt: "aparência retraída" }
      : s.chinPhiltrumRatio < 2.2 ? { en: "neutral", pt: "neutro" }
        : s.chinPhiltrumRatio < 2.65 ? { en: "projected-like visual", pt: "aparência projetada" }
          : { en: "strong", pt: "forte" };
    const eyeClass = s.hunterEyesScore >= 75 ? { en: "hunter-like visual", pt: "visual hunter-like" }
      : s.browEyeGapRatio < 1.15 && s.eyeAspect > 3.2 ? { en: "deep-set-like visual", pt: "visual profundo" }
        : s.eyeAspect < 2.45 ? { en: "round", pt: "redondos" }
          : s.eyeAspect < 2.9 ? { en: "neutral", pt: "neutros" } : { en: "almond", pt: "amendoados" };
    const browClass = s.browStrength >= 70 ? { en: "strong", pt: "forte" }
      : s.browStrength >= 45 ? { en: "neutral", pt: "neutra" } : { en: "soft", pt: "suave" };

    components = [
      modeComponent("harmony", "Facial Harmony", "Harmonia facial", 35, s.harmony, "symmetry + proportional balance"),
      modeComponent("dimorphism", "Masculine Dimorphism", "Dimorfismo masculino", 25, s.masculineDimorphism, "jaw + fWHR + lower third + eye framing"),
      modeComponent("angularity", "Angularity / Structure", "Angularidade / estrutura", 25, s.angularity, "2D contour proxy; not bone"),
      modeComponent("extras", "Extra Feature Balance", "Equilíbrio de características extras", 15, masculineExtras, "eyes + nose + mouth + lips + measured contrast"),
    ];
    formula = "harmony×0.35 + masculine_dimorphism×0.25 + angularity×0.25 + extras×0.15 − measurable penalties";
    classifications = [
      modeClassification("jawline", "Jawline", "Mandíbula", jawClass, "low", "Tecido mole frontal; não mede osso."),
      modeClassification("chin", "Chin", "Queixo", chinClass, "low", "Projection-like proxy; perfil real não foi medido."),
      modeClassification("eyes", "Eyes", "Olhos", eyeClass, "low", "Deep-set e hunter são padrões visuais 2D."),
      modeClassification("brow", "Brow Area", "Área das sobrancelhas", browClass, "low", "Proximidade e inclinação; espessura não é medida."),
      modeClassification("midface", "Midface", "Terço médio", midfaceClass),
      modeClassification("cheekbones", "Cheekbones", "Maçãs do rosto", cheekboneClass, "low"),
      modeClassification("dimorphism", "Facial Dimorphism", "Dimorfismo facial", level3(s.masculineDimorphism), "low"),
      modeClassification("harmony", "Masculine Harmony", "Harmonia masculina", level3(s.harmony)),
    ];
    penalties.push(
      penalty("recessed_chin", "Recessed-like chin", "Queixo com aparência retraída", s.chinPhiltrumRatio < 1.75 ? "applied" : "clear", s.chinPhiltrumRatio < 1.75 ? 0.1 : 0, "Proxy frontal, não diagnóstico de projeção."),
      penalty("narrow_jaw", "Narrow jaw", "Mandíbula estreita", s.jawCheekRatio < 0.78 ? "applied" : "clear", s.jawCheekRatio < 0.78 ? 0.1 : 0),
      penalty("soft_jaw", "Low jaw definition", "Baixa definição mandibular", s.jawlineScore < 45 ? "applied" : "clear", s.jawlineScore < 45 ? 0.08 : 0),
      penalty("hair_occlusion", "Forehead/hair occlusion", "Testa ou cabelo cobrindo proporções", "not_measured", 0),
      penalty("facial_adiposity", "Apparent facial fat", "Gordura facial aparente", "not_measured", 0, "O sistema não estima gordura corporal pelo rosto."),
      penalty("beard_occlusion", "Beard hiding jaw structure", "Barba escondendo a mandíbula", "not_measured", 0),
      penalty("lighting_angle", "Distortion, angle or poor lighting", "Distorção, ângulo ou iluminação ruim", "partially_measured", 0, "Representado apenas na confiança da captura."),
    );
    drivers = [
      { id: "lower_third", score: s.jawlineScore, termEn: "Lower-Third Structure", termPt: "Estrutura do terço inferior", explanation: "Mandíbula, queixo e largura bigonial sustentam a leitura estrutural masculina.", evidence: "2D proxy / proxy 2D" },
      { id: "eye_area", score: s.eyeAreaScore, termEn: "Eye-Area Framing", termPt: "Enquadramento dos olhos", explanation: "Inclinação cantal, abertura e sobrancelhas influenciam o impacto da área ocular.", evidence: "mixed / evidência mista" },
      { id: "harmony", score: s.harmony, termEn: "Facial Harmony", termPt: "Harmonia facial", explanation: "A consistência proporcional evita que uma única característica domine negativamente o conjunto.", evidence: "research-supported construct / construto estudado" },
      { id: "cheekbones", score: s.cheekboneScore, termEn: "Cheekbone Structure", termPt: "Estrutura das maçãs do rosto", explanation: "O contraste entre largura zigomática, têmporas e mandíbula reforça o contorno.", evidence: "2D contour proxy / proxy de contorno" },
    ];
  } else if (mode === "feminine") {
    const feminineSoftness = clamp((100 - s.angularity) * 0.45 + s.feminineDimorphism * 0.35 + s.lipScore * 0.2, 0, 100);
    const feminineHarmony = s.harmony * 0.45 + s.featureBalance * 0.22 + s.symmetry * 0.13 + s.feminineDimorphism * 0.2;
    const eyeLipBalance = s.eyeAreaScore * 0.58 + s.lipScore * 0.42;
    const eyeLipVisualQuality = Number.isFinite(s.facialContrast)
      ? eyeLipBalance * 0.88 + s.facialContrast * 0.12 : eyeLipBalance;
    const centerBalance = average([s.eyeSpacingScore, s.mouthNoseScore, s.noseScore]);
    const cheekLowerBalance = s.cheekboneScore * 0.55 + s.lowerThirdScore * 0.45;
    const jawClass = s.jawCheekRatio < 0.74 ? { en: "delicate", pt: "delicada" }
      : s.jawCheekRatio < 0.8 ? { en: "soft", pt: "suave" }
        : s.jawCheekRatio < 0.89 ? { en: "balanced", pt: "equilibrada" } : { en: "angular", pt: "angular" };
    const chinClass = s.chinPhiltrumRatio < 1.8 ? { en: "small", pt: "pequeno" }
      : s.chinPhiltrumRatio < 2.55 ? { en: "balanced", pt: "equilibrado" } : { en: "projected-like visual", pt: "aparência projetada" };
    const eyeClass = s.eyeSizeRatio > 0.25 && s.eyeAspect < 2.75 ? { en: "large", pt: "grandes" }
      : s.eyeAspect < 2.35 ? { en: "round", pt: "redondos" }
        : s.browEyeGapRatio < 1.1 && s.eyeAspect > 3.35 ? { en: "hooded / deep-set-like visual", pt: "visual hooded / profundo" }
          : { en: "almond", pt: "amendoados" };
    const lipClass = s.lipFullness < 4.2 ? { en: "thin", pt: "finos" }
      : s.lipScore >= 75 ? { en: "balanced", pt: "equilibrados" }
        : s.lipFullness > 6.4 ? { en: "full", pt: "volumosos" } : { en: "medium", pt: "médios" };
    const noseClass = s.noseFaceWidth < 0.2 && s.noseScore >= 60 ? { en: "delicate / narrow", pt: "delicado / estreito" }
      : s.noseFaceWidth < 0.22 ? { en: "narrow", pt: "estreito" }
        : s.noseFaceWidth <= 0.28 ? { en: "medium", pt: "médio" } : { en: "wide", pt: "largo" };

    components = [
      modeComponent("harmony", "Feminine Harmony", "Harmonia feminina", 25, feminineHarmony, "global proportions + feature balance"),
      modeComponent("softness", "Facial Softness / Femininity", "Suavidade / feminilidade visual", 18, feminineSoftness, "jaw taper + feature softness; user-selected target"),
      modeComponent("eyes_lips", "Eye/Lip Proportions + Contrast", "Proporções de olhos/lábios + contraste", 18, eyeLipVisualQuality, "eye framing + lip balance + measured feature contrast"),
      modeComponent("symmetry", "Symmetry", "Simetria", 12, s.symmetry, "bilateral landmark geometry"),
      modeComponent("center_balance", "Nose/Eye/Mouth Balance", "Equilíbrio nariz/olhos/boca", 10, centerBalance, "central feature ratios"),
      modeComponent("cheek_lower", "Cheekbones and Lower Third", "Maçãs do rosto e lower third", 10, cheekLowerBalance, "2D contour balance"),
      modeComponent("skin", "Skin-Surface Uniformity Proxy", "Proxy de uniformidade superficial da pele", 7, s.skinHomogeneity, Number.isFinite(s.skinHomogeneity) ? "pixel texture under current lighting" : "not scored without a usable image signal"),
    ];
    formula = Number.isFinite(s.skinHomogeneity)
      ? "feminine harmony×0.25 + softness×0.18 + eyes/lips×0.18 + symmetry×0.12 + central balance×0.10 + cheek/lower-third×0.10 + skin-surface proxy×0.07 − penalties"
      : "feminine weighted model; unavailable skin-surface weight excluded and measured weights normalized";
    classifications = [
      modeClassification("face_shape", "Face Shape", "Formato do rosto", { en: s.shape.label.split(" / ")[0].toLowerCase(), pt: s.shape.label.split(" / ")[1].toLowerCase() }),
      modeClassification("jawline", "Jawline", "Mandíbula", jawClass, "low", "Classificação de contorno frontal."),
      modeClassification("chin", "Chin", "Queixo", chinClass, "low", "Projeção real exige perfil."),
      modeClassification("eyes", "Eyes", "Olhos", eyeClass, "low", "Hooded e deep-set são apenas padrões visuais aproximados."),
      modeClassification("lips", "Lips", "Lábios", lipClass),
      modeClassification("nose", "Nose", "Nariz", noseClass, "medium", "Prominência real exige perfil; aqui usamos largura e equilíbrio frontal."),
      modeClassification("midface", "Midface", "Terço médio", midfaceClass),
      modeClassification("cheekbones", "Cheekbones", "Maçãs do rosto", cheekboneClass, "low"),
      modeClassification("softness", "Facial Softness", "Suavidade facial", level3(feminineSoftness), "low"),
      modeClassification("harmony", "Feminine Harmony", "Harmonia feminina", level3(feminineHarmony)),
      modeClassification("skin", "Skin-Surface Uniformity Proxy", "Proxy de uniformidade superficial da pele", Number.isFinite(s.skinHomogeneity) ? level3(s.skinHomogeneity) : { en: "not measured", pt: "não medido" }, Number.isFinite(s.skinHomogeneity) ? "low" : "unsupported", "Varia com luz, maquiagem, câmera e compressão; não mede saúde da pele."),
    ];
    penalties.push(
      penalty("central_disharmony", "Nose/eye/mouth disharmony", "Desarmonia entre nariz, olhos e boca", centerBalance < 45 ? "applied" : "clear", centerBalance < 45 ? 0.1 : 0),
      penalty("heavy_lower_third", "Heavy lower third for selected target", "Lower third pesado para o objetivo escolhido", s.jawCheekRatio > 0.9 ? "applied" : "clear", s.jawCheekRatio > 0.9 ? 0.1 : 0),
      penalty("wide_jaw_target", "Very wide jaw for classic feminine target", "Jawline muito larga para estética feminina clássica", s.jawCheekRatio > 0.93 ? "applied" : "clear", s.jawCheekRatio > 0.93 ? 0.08 : 0),
      penalty("skin", "Low skin-surface uniformity signal", "Baixo sinal de uniformidade superficial", Number.isFinite(s.skinHomogeneity) ? (s.skinHomogeneity < 42 ? "applied" : "clear") : "not_measured", Number.isFinite(s.skinHomogeneity) && s.skinHomogeneity < 42 ? 0.08 : 0, "Sinal de pixels dependente de iluminação; não mede saúde da pele."),
      penalty("hair_occlusion", "Hair covering landmarks", "Cabelo cobrindo landmarks", "not_measured", 0),
      penalty("expression", "Strong expression", "Expressão facial forte", "not_measured", 0),
      penalty("lighting_angle", "Distortion, angle or poor lighting", "Distorção, ângulo ou iluminação ruim", "partially_measured", 0, "Representado apenas na confiança da captura."),
    );
    drivers = [
      { id: "feminine_harmony", score: feminineHarmony, termEn: "Feminine Harmony", termPt: "Harmonia feminina", explanation: "Integra proporções, simetria e equilíbrio sem reduzir o resultado a delicadeza isolada.", evidence: "mixed research / pesquisa mista" },
      { id: "eyes_lips", score: eyeLipBalance, termEn: "Eye and Lip Proportions", termPt: "Proporções de olhos e lábios", explanation: "A área ocular e o equilíbrio labial recebem peso próprio neste modo.", evidence: "mode-specific heuristic / heurística do modo" },
      { id: "softness", score: feminineSoftness, termEn: "Facial Softness", termPt: "Suavidade facial", explanation: "Descreve taper mandibular e transições do contorno; não define gênero ou identidade.", evidence: "2D shape proxy / proxy de forma" },
      { id: "cheekbones", score: s.cheekboneScore, termEn: "Cheekbone Balance", termPt: "Equilíbrio das maçãs do rosto", explanation: "Observa o contraste entre maçãs, têmporas e lower third.", evidence: "2D contour proxy / proxy de contorno" },
    ];
  } else {
    const proportionScore = average([s.thirdsScore, s.eyeSpacingScore, s.mouthNoseScore, s.faceRatioScore, s.chinPhiltrumScore]);
    const distinctiveness = clamp(38 + standardDeviation([s.eyeAreaScore, s.jawlineScore, s.cheekboneScore, s.lipScore, s.fwhrScore]) * 1.35, 28, 88);
    const photogenicProxy = average([s.captureConfidence, s.symmetry, s.eyeBalance, proportionScore]);
    const visualImpact = average([s.eyeAreaScore, s.angularity, s.cheekboneScore, distinctiveness]);
    const editorialPotential = s.harmony * 0.28 + distinctiveness * 0.28 + photogenicProxy * 0.2 + visualImpact * 0.24;
    const visualPresentation = average([distinctiveness, visualImpact, Number.isFinite(s.facialContrast) ? s.facialContrast : photogenicProxy]);
    const visualStyleClass = Number.isFinite(s.facialContrast) && s.facialContrast >= 68 && s.angularity >= 58
      ? { en: "graphic / high-contrast", pt: "gráfico / alto contraste" }
      : distinctiveness >= 68 ? { en: "editorial-distinctive", pt: "editorial distintivo" }
        : Number.isFinite(s.facialContrast) && s.facialContrast < 38 ? { en: "soft / low-contrast", pt: "suave / baixo contraste" }
          : { en: "balanced presentation", pt: "apresentação equilibrada" };
    components = [
      modeComponent("harmony", "General Harmony", "Harmonia geral", 25, s.harmony, "global balance"),
      modeComponent("symmetry", "Symmetry", "Simetria", 20, s.symmetry, "bilateral geometry"),
      modeComponent("proportions", "Facial Proportions", "Proporções faciais", 18, proportionScore, "thirds + central ratios"),
      modeComponent("photogenic", "Photogenic Proxy", "Proxy de fotogenia", 12, photogenicProxy, "capture stability + geometric consistency"),
      modeComponent("distinctiveness", "Aesthetic Distinctiveness", "Singularidade estética", 12, distinctiveness, "structural variation; not beauty rank"),
      modeComponent("impact", "Visual Impact", "Impacto visual", 8, visualImpact, "eye area + contour + distinctiveness"),
      modeComponent("contrast", "Facial Contrast", "Contraste facial", 5, s.facialContrast, Number.isFinite(s.facialContrast) ? "relative feature-to-skin luminance" : "not scored without usable pixels"),
    ];
    formula = Number.isFinite(s.facialContrast)
      ? "general harmony + symmetry + proportions + photogenic proxy + distinctiveness + visual impact + facial contrast"
      : "neutral/editorial weighted model; unavailable facial-contrast weight excluded and measured weights normalized";
    classifications = [
      modeClassification("harmony", "General Harmony", "Harmonia geral", level3(s.harmony)),
      modeClassification("symmetry", "Symmetry", "Simetria", level3(s.symmetry)),
      modeClassification("proportions", "Facial Proportions", "Proporções faciais", level3(proportionScore)),
      modeClassification("photogenic", "Photogenic Proxy", "Proxy de fotogenia", level3(photogenicProxy), "medium"),
      modeClassification("singularity", "Aesthetic Distinctiveness", "Singularidade estética", level3(distinctiveness), "low", "Distância estrutural do centro da própria heurística, não raridade populacional."),
      modeClassification("editorial", "Editorial Potential", "Potencial editorial", level3(editorialPotential), "low"),
      modeClassification("style", "Visual Presentation Proxy", "Proxy de apresentação visual", visualStyleClass, "low", `Combina contraste, angularidade e distintividade (${round(visualPresentation)}%); não avalia roupa, cabelo ou direção criativa.`),
      modeClassification("contrast", "Facial Contrast", "Contraste facial", Number.isFinite(s.facialContrast) ? level3(s.facialContrast) : { en: "not measured", pt: "não medido" }, Number.isFinite(s.facialContrast) ? "low" : "unsupported", "Sinal de luminância, não avaliação de cor ou maquiagem."),
      modeClassification("impact", "Visual Impact", "Impacto visual", level3(visualImpact), "low"),
    ];
    penalties.push(
      penalty("distortion", "Distortion or poor angle", "Distorção ou ângulo ruim", "partially_measured", 0, "Representado na confiança de captura."),
      penalty("style_context", "Missing styling context", "Contexto visual ausente", "not_measured", 0),
    );
    drivers = [
      { id: "editorial", score: editorialPotential, termEn: "Editorial Potential", termPt: "Potencial editorial", explanation: "Combina harmonia, distintividade e impacto sem favorecer masculinidade ou feminilidade.", evidence: "experimental editorial heuristic / heurística editorial" },
      { id: "distinctiveness", score: distinctiveness, termEn: "Aesthetic Distinctiveness", termPt: "Singularidade estética", explanation: "Variação estrutural pode contribuir para memorabilidade sem ser tratada como defeito.", evidence: "experimental / experimental" },
      { id: "photogenic", score: photogenicProxy, termEn: "Photogenic Proxy", termPt: "Proxy de fotogenia", explanation: "Estabilidade de captura, simetria aparente e proporções sustentam consistência entre fotos.", evidence: "capture-dependent proxy / depende da captura" },
      { id: "harmony", score: s.harmony, termEn: "General Harmony", termPt: "Harmonia geral", explanation: "Mantém o conjunto legível enquanto a distintividade preserva caráter visual.", evidence: "mixed research / pesquisa mista" },
    ];
  }

  const measuredCore = components.filter((item) => Number.isFinite(item.scorePercent) && item.weight >= 8);
  const weakestCore = measuredCore.length ? Math.min(...measuredCore.map((item) => item.scorePercent)) : 0;
  const componentSpread = measuredCore.length ? standardDeviation(measuredCore.map((item) => item.scorePercent)) : 0;
  penalties.push(
    penalty("weakest_link", "Weakest-link imbalance", "Desequilíbrio do componente mais fraco", weakestCore < 40 ? "applied" : weakestCore < 50 ? "applied" : "clear", weakestCore < 40 ? 0.18 : weakestCore < 50 ? 0.1 : 0, "Calibração rígida: uma média alta não apaga um componente estrutural muito baixo."),
    penalty("component_spread", "Large component spread", "Grande dispersão entre componentes", componentSpread > 22 ? "applied" : "clear", componentSpread > 22 ? 0.08 : 0, "Reduz resultados inflados por um único pico muito alto."),
  );
  drivers = drivers.sort((a, b) => b.score - a.score).map((item, index) => ({ ...item, rank: index + 1, score: round(item.score, 1) }));
  const weightedPercent = weightedComponentScore(components);
  const totalPenalty = round(penalties.filter((item) => item.status === "applied").reduce((sum, item) => sum + item.points, 0), 2);
  return { components, classifications, penalties, formula, drivers, weightedPercent: round(weightedPercent, 1), totalPenalty };
}

export function analyzeImageSignals(sourceCanvas, landmarks) {
  if (!sourceCanvas?.getContext || !landmarks?.length) return {};
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  if (!width || !height) return {};
  const context = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const pixels = context.getImageData(0, 0, width, height).data;
  const faceWidthPx = Math.abs((landmarks[454]?.x ?? 0.7) - (landmarks[234]?.x ?? 0.3)) * width;
  const radius = Math.max(3, Math.round(faceWidthPx * 0.045));

  function patchStats(index, scale = 1) {
    const point = landmarks[index];
    if (!point) return null;
    const centerX = Math.round(point.x * width);
    const centerY = Math.round(point.y * height);
    const patchRadius = Math.max(2, Math.round(radius * scale));
    const values = [];
    const labs = [];
    for (let y = Math.max(0, centerY - patchRadius); y <= Math.min(height - 1, centerY + patchRadius); y += 2) {
      for (let x = Math.max(0, centerX - patchRadius); x <= Math.min(width - 1, centerX + patchRadius); x += 2) {
        const offset = (y * width + x) * 4;
        const alpha = pixels[offset + 3];
        if (alpha < 200) continue;
        const red = pixels[offset];
        const green = pixels[offset + 1];
        const blue = pixels[offset + 2];
        const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
        values.push(luminance);
        labs.push(rgbToLab(red, green, blue));
      }
    }
    if (!values.length) return null;
    const mean = average(values);
    const deviation = Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
    return {
      mean,
      deviation,
      lab: {
        l: average(labs.map((item) => item.l)),
        a: average(labs.map((item) => item.a)),
        b: average(labs.map((item) => item.b)),
      },
    };
  }

  const leftCheek = patchStats(117, 1.25);
  const rightCheek = patchStats(346, 1.25);
  const forehead = patchStats(151, 1.05);
  const skinPatches = [leftCheek, rightCheek, forehead].filter(Boolean);
  if (skinPatches.length < 2) return {};
  const averageDeviation = average(skinPatches.map((item) => item.deviation));
  const textureUniformity = clamp(100 - averageDeviation * 2.35, 0, 100);
  const cheekDifference = leftCheek && rightCheek ? Math.abs(leftCheek.mean - rightCheek.mean) : 0;
  const foreheadDifference = forehead ? Math.abs(forehead.mean - average([leftCheek?.mean, rightCheek?.mean].filter(Number.isFinite))) : 0;
  const lightingUniformity = clamp(100 - cheekDifference * 1.65 - foreheadDifference * 0.65, 0, 100);
  const skinHomogeneity = clamp(textureUniformity * 0.72 + lightingUniformity * 0.28, 0, 100);

  const eyePatches = [patchStats(468, 0.62), patchStats(473, 0.62)].filter(Boolean);
  const browPatches = [patchStats(105, 0.62), patchStats(334, 0.62)].filter(Boolean);
  const mouthPatches = [patchStats(0, 0.62), patchStats(17, 0.62)].filter(Boolean);
  const featureGroups = [eyePatches, browPatches, mouthPatches];
  const surroundingGroups = [
    [patchStats(117, 0.72), patchStats(346, 0.72)].filter(Boolean),
    [patchStats(151, 0.72), patchStats(108, 0.62), patchStats(337, 0.62)].filter(Boolean),
    [patchStats(205, 0.72), patchStats(425, 0.72), patchStats(164, 0.62)].filter(Boolean),
  ];
  const skinMean = average(skinPatches.map((item) => item.mean));
  const groupContrasts = featureGroups.map((group, index) => {
    const surroundings = surroundingGroups[index];
    if (!group.length || !surroundings.length) return null;
    const featureMean = average(group.map((item) => item.mean));
    const surroundingMean = average(surroundings.map((item) => item.mean));
    const featureLab = {
      l: average(group.map((item) => item.lab.l)),
      a: average(group.map((item) => item.lab.a)),
      b: average(group.map((item) => item.lab.b)),
    };
    const surroundingLab = {
      l: average(surroundings.map((item) => item.lab.l)),
      a: average(surroundings.map((item) => item.lab.a)),
      b: average(surroundings.map((item) => item.lab.b)),
    };
    return {
      luminance: adaptedMichelson(surroundingLab.l, featureLab.l) * 100,
      deltaE: Math.hypot(surroundingLab.l - featureLab.l, surroundingLab.a - featureLab.a, surroundingLab.b - featureLab.b),
      surroundingMean,
      featureMean,
    };
  });
  const usableContrasts = groupContrasts.filter(Boolean);
  const luminanceContrast = average(usableContrasts.map((item) => item.luminance));
  const colorContrast = average(usableContrasts.map((item) => item.deltaE));
  const facialContrast = clamp(luminanceContrast * 2.8, 0, 100);
  const exposureQuality = targetAlignment((skinMean / 255) * 100, 56, 32);
  const contrastConfidence = clamp(lightingUniformity * 0.62 + exposureQuality * 0.28 + Math.min(usableContrasts.length, 3) / 3 * 10, 0, 100);
  return {
    skinHomogeneity: round(skinHomogeneity, 1),
    facialContrast: round(facialContrast, 1),
    luminanceContrast: round(luminanceContrast, 2),
    colorContrastDeltaE: round(colorContrast, 2),
    eyeContrast: round(groupContrasts[0]?.luminance ?? 0, 2),
    browContrast: round(groupContrasts[1]?.luminance ?? 0, 2),
    mouthContrast: round(groupContrasts[2]?.luminance ?? 0, 2),
    contrastConfidence: round(contrastConfidence, 1),
    lightingUniformity: round(lightingUniformity, 1),
    brightness: round((skinMean / 255) * 100, 1),
    status: contrastConfidence >= 60 ? "multi_region_pixel_proxy" : "low_confidence_pixel_proxy",
  };
}

export function analyzeLandmarks(rawLandmarks, options = {}) {
  if (!rawLandmarks || rawLandmarks.length < 478) throw new Error("Landmarks faciais insuficientes.");
  const aspectRatio = options.aspectRatio || 1;
  const points = normalizedLandmarks(rawLandmarks, aspectRatio);
  const presentationTarget = ["masculine", "feminine", "neutral"].includes(options.presentationTarget)
    ? options.presentationTarget : "neutral";

  const faceWidth = pointDistance(points[234], points[454]);
  const faceHeight = pointDistance(points[10], points[152]);
  const jawWidth = pointDistance(points[172], points[397]);
  const templeWidth = pointDistance(points[54], points[284]);
  const mouthWidth = pointDistance(points[61], points[291]);
  const noseWidth = pointDistance(points[98], points[327]);
  const noseHeight = pointDistance(points[168], points[2]);
  const rightEyeWidth = pointDistance(points[33], points[133]);
  const leftEyeWidth = pointDistance(points[263], points[362]);
  const rightEyeHeight = pointDistance(points[159], points[145]);
  const leftEyeHeight = pointDistance(points[386], points[374]);
  const intercanthalWidth = pointDistance(points[133], points[362]);
  const interpupillaryWidth = pointDistance(points[468] || points[133], points[473] || points[362]);
  const upperLipHeight = pointDistance(points[0], points[13]);
  const lowerLipHeight = pointDistance(points[14], points[17]);

  const leftCanthalTilt = tiltAngle(points[362], points[263]);
  const rightCanthalTilt = tiltAngle(points[133], points[33]);
  const averageCanthalTilt = (leftCanthalTilt + rightCanthalTilt) / 2;
  const leftEyeAspect = leftEyeWidth / Math.max(leftEyeHeight, 0.0001);
  const rightEyeAspect = rightEyeWidth / Math.max(rightEyeHeight, 0.0001);
  const eyeAspect = (leftEyeAspect + rightEyeAspect) / 2;
  const averageEyeWidth = (leftEyeWidth + rightEyeWidth) / 2;
  const eyeSpacing = intercanthalWidth / Math.max(averageEyeWidth, 0.0001);
  const mouthNoseRatio = mouthWidth / Math.max(noseWidth, 0.0001);
  const noseWidthHeightRatio = noseWidth / Math.max(noseHeight, 0.0001);
  const faceLengthWidth = faceHeight / Math.max(faceWidth, 0.0001);
  const jawCheekRatio = jawWidth / Math.max(faceWidth, 0.0001);
  const templeCheekRatio = templeWidth / Math.max(faceWidth, 0.0001);
  const lipRatio = lowerLipHeight / Math.max(upperLipHeight, 0.0001);
  const browY = average([points[70].y, points[105].y, points[300].y, points[334].y]);
  const upperThird = Math.abs(browY - points[10].y) / Math.max(faceHeight, 0.0001) * 100;
  const middleThird = Math.abs(points[2].y - browY) / Math.max(faceHeight, 0.0001) * 100;
  const lowerThird = Math.abs(points[152].y - points[2].y) / Math.max(faceHeight, 0.0001) * 100;
  const midfaceRatio = Math.abs(points[2].y - browY) / Math.max(interpupillaryWidth, 0.0001);
  const upperFaceHeight = Math.abs(points[13].y - browY);
  const fwhr = faceWidth / Math.max(upperFaceHeight, 0.0001);
  const philtrumHeight = pointDistance(points[2], points[0]);
  const chinHeight = pointDistance(points[17], points[152]);
  const chinPhiltrumRatio = chinHeight / Math.max(philtrumHeight, 0.0001);
  const leftBrowTilt = tiltAngle(points[105], points[70]);
  const rightBrowTilt = tiltAngle(points[334], points[300]);
  const browTilt = (leftBrowTilt + rightBrowTilt) / 2;
  const leftJawAngle = angleAt(points[234], points[172], points[152]);
  const rightJawAngle = angleAt(points[454], points[397], points[152]);
  const frontalJawAngle = (leftJawAngle + rightJawAngle) / 2;
  const browEyeGapRatio = average([
    pointDistance(points[105], points[159]) / Math.max(rightEyeHeight, 0.0001),
    pointDistance(points[334], points[386]) / Math.max(leftEyeHeight, 0.0001),
  ]);
  const eyeSizeRatio = averageEyeWidth / Math.max(faceWidth, 0.0001);
  const lipFullness = pointDistance(points[0], points[17]) / Math.max(faceHeight, 0.0001) * 100;
  const noseFaceWidth = noseWidth / Math.max(faceWidth, 0.0001);

  const symmetry = symmetryScore(points, faceWidth);
  const eyeBalance = bilateralEyeScore(leftCanthalTilt, rightCanthalTilt, leftEyeAspect, rightEyeAspect);
  const shape = classifyFaceShape(faceLengthWidth, jawCheekRatio, templeCheekRatio);
  const thirdsScore = average([
    targetAlignment(upperThird, 33.33, 8),
    targetAlignment(middleThird, 33.33, 8),
    targetAlignment(lowerThird, 33.33, 8),
  ]);
  const canthalScore = rangeAlignment(averageCanthalTilt, 5.2, 8.5);
  const eyeSpacingScore = rangeAlignment(eyeSpacing, 0.93, 1.04);
  const eyeAspectScore = rangeAlignment(eyeAspect, 2.8, 3.6);
  const mouthNoseScore = rangeAlignment(mouthNoseRatio, 1.38, 1.53);
  const jawWidthScore = rangeAlignment(jawCheekRatio, 0.855, 0.92);
  const lipScore = rangeAlignment(lipRatio, 1.4, 2);
  const noseScore = rangeAlignment(noseWidthHeightRatio, 0.62, 0.88);
  const fwhrScore = rangeAlignment(fwhr, 1.9, 2.06);
  const chinPhiltrumScore = rangeAlignment(chinPhiltrumRatio, 2.05, 2.55);
  const lowerThirdScore = rangeAlignment(lowerThird, 30.6, 34);
  const browScore = rangeAlignment(Math.abs(browTilt), 5, 13);
  const browStrength = clamp(100 - (browEyeGapRatio - 0.7) * 55, 0, 100);
  const hunterEyesScore = canthalScore * 0.4 + eyeAspectScore * 0.3 + eyeBalance * 0.3;
  const jawlineScore = jawWidthScore * 0.5 + symmetry * 0.2 + lowerThirdScore * 0.3;
  const eyeAreaScore = average([hunterEyesScore, eyeBalance, eyeSpacingScore]);
  const featureBalance = average([eyeAreaScore, mouthNoseScore, lipScore, noseScore, chinPhiltrumScore, browScore]);
  const cheekboneScore = average([rangeAlignment(jawCheekRatio, 0.76, 0.88), rangeAlignment(templeCheekRatio, 0.84, 0.95)]);
  const harmony = [
    symmetry * 0.26, thirdsScore * 0.2, eyeSpacingScore * 0.1, mouthNoseScore * 0.1,
    rangeAlignment(faceLengthWidth, 1.3, 1.48) * 0.12, eyeBalance * 0.1, lipScore * 0.06,
    chinPhiltrumScore * 0.06,
  ].reduce((sum, value) => sum + value, 0);
  const faceRatioScore = rangeAlignment(faceLengthWidth, 1.3, 1.48);
  const angularity = jawlineScore * 0.45 + hunterEyesScore * 0.22 + fwhrScore * 0.18 + browScore * 0.15;
  const masculineDimorphism = jawWidthScore * 0.34 + fwhrScore * 0.26 + lowerThirdScore * 0.2 + hunterEyesScore * 0.2;
  const feminineDimorphism = [
    rangeAlignment(jawCheekRatio, 0.72, 0.84) * 0.28,
    rangeAlignment(eyeAspect, 2.2, 3.0) * 0.24,
    lipScore * 0.2,
    rangeAlignment(faceLengthWidth, 1.32, 1.5) * 0.16,
    thirdsScore * 0.12,
  ].reduce((sum, value) => sum + value, 0);
  const neutralDefinition = average([harmony, angularity, featureBalance]);
  const dimorphism = presentationTarget === "masculine" ? masculineDimorphism
    : presentationTarget === "feminine" ? feminineDimorphism : neutralDefinition;
  const captureConfidence = round(clamp(options.confidence ?? 72, 0, 100), 1);
  const imageSignals = options.imageSignals || {};
  const skinSignalUsable = Number.isFinite(imageSignals.skinHomogeneity)
    && Number.isFinite(imageSignals.lightingUniformity) && imageSignals.lightingUniformity >= 45;
  const contrastSignalUsable = Number.isFinite(imageSignals.facialContrast)
    && (Number.isFinite(imageSignals.contrastConfidence) ? imageSignals.contrastConfidence >= 25 : true);
  const depthSignals = relativeDepthSignals(points, options.depthSignals || {});
  const modeAnalysis = createModeAnalysis(presentationTarget, {
    shape, harmony, symmetry, thirdsScore, eyeSpacingScore, mouthNoseScore, noseScore,
    faceRatioScore, chinPhiltrumScore, lowerThirdScore, lipScore, fwhrScore, angularity,
    masculineDimorphism, feminineDimorphism, featureBalance, jawlineScore, eyeAreaScore,
    hunterEyesScore, cheekboneScore, eyeBalance, captureConfidence, middleThird,
    jawCheekRatio, chinPhiltrumRatio, browEyeGapRatio, eyeAspect, eyeSizeRatio,
    lipFullness, noseFaceWidth, browStrength, depthSignals,
    skinHomogeneity: skinSignalUsable ? imageSignals.skinHomogeneity : null,
    facialContrast: contrastSignalUsable ? imageSignals.facialContrast : null,
    lightingUniformity: Number.isFinite(imageSignals.lightingUniformity) ? imageSignals.lightingUniformity : null,
  });
  const calibratedBasePsl = toPsl(modeAnalysis.weightedPercent);
  const preGatePsl = clamp(calibratedBasePsl - modeAnalysis.totalPenalty, 1, 8);
  const coreComponentScores = modeAnalysis.components.filter((item) => Number.isFinite(item.scorePercent) && item.weight >= 8).map((item) => item.scorePercent);
  const weakestCoreComponent = coreComponentScores.length ? Math.min(...coreComponentScores) : 0;
  const gateReasons = [];
  const reliabilityWarnings = [];
  const liteGateLabel = presentationTarget === "masculine" ? "CHADLITE"
    : presentationTarget === "feminine" ? "STACYLITE" : "LITE";
  let tierCap = 8;
  if (preGatePsl >= 5.5 && harmony < 62) { tierCap = Math.min(tierCap, 5.49); gateReasons.push(`${liteGateLabel} entry requires harmony ≥62`); }
  if (preGatePsl >= 5.5 && featureBalance < 48) { tierCap = Math.min(tierCap, 5.49); gateReasons.push(`${liteGateLabel} entry requires feature balance ≥48`); }
  if (preGatePsl >= 5.5 && weakestCoreComponent < 38) { tierCap = Math.min(tierCap, 5.49); gateReasons.push(`${liteGateLabel} entry requires every core component ≥38`); }
  if (preGatePsl >= 6 && (harmony < 70 || angularity < 50 || symmetry < 58)) { tierCap = Math.min(tierCap, 5.99); gateReasons.push("elite consistency gate not met"); }
  if (preGatePsl >= 6.5 && (harmony < 76 || symmetry < 66 || featureBalance < 62)) { tierCap = Math.min(tierCap, 6.49); gateReasons.push("upper-elite consistency gate not met"); }
  if (captureConfidence < 68) reliabilityWarnings.push("capture confidence below 68; read the result as a wider estimate");
  const pslScore = round(clamp(Math.min(preGatePsl, tierCap), 1, 8), 2);
  const uncertainty = round(clamp(0.18 + (100 - captureConfidence) * 0.009, 0.2, 0.62), 2);
  const estimatedRange = {
    low: round(clamp(pslScore - uncertainty, 1, 8), 2),
    high: round(clamp(pslScore + uncertainty, 1, 8), 2),
  };
  const tier = tierForPsl(pslScore, presentationTarget);
  const geometryIndex = round(average([harmony, angularity, featureBalance]), 1);
  const components = modeAnalysis.components;

  const hunterVerdict = hunterEyesScore >= 75 ? "Strong Hunter-Eyes Pattern / Padrão forte"
    : hunterEyesScore >= 60 ? "Partial Hunter-Eyes Pattern / Padrão parcial"
      : "Hunter-Eyes Pattern not indicated / Padrão não indicado";
  const nasalDepthScore = rangeAlignment(depthSignals.nasalProjection, 10, 24);
  const chinDepthScore = rangeAlignment(depthSignals.chinProjection, 2.5, 11);
  const orbitalSupportScore = rangeAlignment(depthSignals.orbitalSupport, 1.5, 7);
  const ramusSurfaceScore = rangeAlignment(depthSignals.ramusSurfaceRatio, 13, 28);
  const surfaceGonialScore = rangeAlignment(depthSignals.surfaceGonialAngle, 105, 135);
  const neckMeasurementUsable = Number.isFinite(depthSignals.neckSignal?.angle)
    && depthSignals.neckSignal.confidence >= 35;
  const cervicomentalScore = neckMeasurementUsable
    ? rangeAlignment(depthSignals.neckSignal.angle, 90, 105) : null;
  const softTissueDefinition = average([angularity, jawlineScore, cheekboneScore]);
  const contrastRaw = contrastSignalUsable
    ? `L* ${round(imageSignals.luminanceContrast ?? 0, 2)}% | EYES ${round(imageSignals.eyeContrast ?? 0, 2)} | BROWS ${round(imageSignals.browContrast ?? 0, 2)} | MOUTH ${round(imageSignals.mouthContrast ?? 0, 2)} | ΔE ${round(imageSignals.colorContrastDeltaE ?? 0, 2)}`
    : "PIXELS_UNAVAILABLE";

  const traits = [
    trait({ id: "facial_harmony", en: "Facial Harmony", pt: "Harmonia facial", score: harmony, raw: round(harmony), unit: "%", confidence: "medium", source: "mixed_research" }),
    trait({ id: "sexual_dimorphism", en: presentationTarget === "neutral" ? "Morphological Definition" : "Sexual Dimorphism Cues", pt: presentationTarget === "neutral" ? "Definição morfológica" : "Pistas de dimorfismo sexual", score: dimorphism, raw: targetLabelsForEngine(presentationTarget), unit: "selected profile", confidence: "low", source: "community_proxy", note: "O perfil é escolhido pelo usuário; sexo ou gênero não são inferidos pela câmera." }),
    trait({ id: "angularity", en: "Angularity / Bone-Structure Proxy", pt: "Angularidade / proxy de estrutura óssea", score: angularity, raw: round(angularity), unit: "%", confidence: "low", source: "2d_proxy", note: "Landmarks descrevem contorno superficial, não osso real." }),
    trait({ id: "feature_balance", en: "Miscellaneous Feature Balance", pt: "Equilíbrio de características extras", score: featureBalance, raw: round(featureBalance), unit: "%", confidence: "medium", source: "community_proxy", note: "Não inclui pele, cabelo, dentes ou contraste de cor." }),
    trait({ id: "skin_surface_uniformity", en: "Skin-Surface Uniformity Proxy", pt: "Proxy de uniformidade superficial da pele", score: skinSignalUsable ? imageSignals.skinHomogeneity : null, raw: skinSignalUsable ? round(imageSignals.skinHomogeneity) : "UNRELIABLE_OR_UNAVAILABLE_LIGHTING", unit: "%", confidence: "low", source: skinSignalUsable ? "pixel_proxy" : "not_measured", note: "Depende de iluminação, maquiagem, câmera e compressão; não mede saúde da pele." }),
    trait({ id: "facial_contrast", en: "Facial Contrast (L* + ΔE)", pt: "Contraste facial (L* + ΔE)", score: contrastSignalUsable ? imageSignals.facialContrast : null, raw: contrastRaw, unit: "adapted Michelson + CIELAB", confidence: contrastSignalUsable && imageSignals.contrastConfidence >= 60 ? "medium" : "low", source: contrastSignalUsable ? "pixel_proxy" : "not_measured", note: `Olhos, sobrancelhas e boca contra pele adjacente. Confiança ${round(imageSignals.contrastConfidence ?? 0)}%; descreve contraste visual, não valor estético universal.` }),
    trait({ id: "facial_symmetry", en: "Facial Symmetry", pt: "Simetria facial", score: symmetry, raw: round(symmetry), unit: "%", confidence: "high", source: "geometry" }),
    trait({ id: "facial_thirds", en: "Facial Thirds", pt: "Terços faciais", score: thirdsScore, raw: `${round(upperThird, 1)} / ${round(middleThird, 1)} / ${round(lowerThird, 1)}`, unit: "%", confidence: "low", source: "2d_proxy", note: "O topo da testa não é a linha capilar real." }),
    trait({ id: "fwhr", en: "Facial Width-to-Height Ratio (fWHR)", pt: "Relação largura-altura facial", score: fwhrScore, raw: round(fwhr), unit: "ratio", confidence: "medium", source: "anthropometry" }),
    trait({ id: "midface_ratio", en: "Midface Ratio", pt: "Proporção do terço médio", score: thirdsScore, raw: round(midfaceRatio), unit: "ratio", confidence: "low", source: "community_proxy", note: "Definições variam entre fóruns." }),
    trait({ id: "eye_spacing", en: "Eye Spacing", pt: "Espaçamento ocular", score: eyeSpacingScore, raw: round(eyeSpacing), unit: "ratio", confidence: "high", source: "anthropometry" }),
    trait({ id: "canthal_tilt", en: "Canthal Tilt", pt: "Inclinação cantal", score: canthalScore, raw: round(averageCanthalTilt), unit: "°", confidence: "high", source: "geometry" }),
    { ...trait({ id: "hunter_eyes", en: "Hunter Eyes Pattern", pt: "Padrão de olhos hunter", score: hunterEyesScore, raw: hunterVerdict, confidence: "low", source: "community_proxy", note: "Proxy frontal: não mede profundidade orbital nem estrutura óssea." }), verdict: { en: hunterVerdict.split(" / ")[0], pt: hunterVerdict.split(" / ")[1] } },
    trait({ id: "eye_aspect_ratio", en: "Palpebral Fissure Ratio", pt: "Proporção da fissura palpebral", score: eyeAspectScore, raw: round(eyeAspect), unit: "ratio", confidence: "high", source: "anthropometry" }),
    trait({ id: "eye_balance", en: "Bilateral Eye Balance", pt: "Equilíbrio bilateral dos olhos", score: eyeBalance, raw: round(eyeBalance), unit: "%", confidence: "high", source: "geometry" }),
    trait({ id: "eyebrow_tilt", en: "Eyebrow Tilt", pt: "Inclinação das sobrancelhas", score: browScore, raw: round(browTilt), unit: "°", confidence: "medium", source: "2d_proxy" }),
    trait({ id: "jawline", en: "Jawline Definition Proxy", pt: "Proxy de definição da mandíbula", score: jawlineScore, raw: round(jawCheekRatio * 100), unit: "% bizygomatic", confidence: "low", source: "2d_proxy", note: "Contorno de tecido mole, não estrutura óssea." }),
    trait({ id: "frontal_jaw_angle", en: "Frontal Jaw Angle", pt: "Ângulo frontal da mandíbula", score: jawlineScore, raw: round(frontalJawAngle), unit: "°", confidence: "low", source: "2d_proxy" }),
    trait({ id: "bigonial_width", en: "Bigonial Width", pt: "Largura bigonial", score: jawWidthScore, raw: round(jawCheekRatio * 100), unit: "% bizygomatic", confidence: "medium", source: "2d_proxy" }),
    trait({ id: "bitemporal_width", en: "Bitemporal Width", pt: "Largura bitemporal", score: rangeAlignment(templeCheekRatio, 0.84, 0.95), raw: round(templeCheekRatio * 100), unit: "% bizygomatic", confidence: "low", source: "2d_proxy", note: "Cabelo pode ocultar as têmporas." }),
    trait({ id: "cheekbone_prominence", en: "Cheekbone Prominence Proxy", pt: "Proxy de proeminência das maçãs do rosto", score: cheekboneScore, raw: round((1 - jawCheekRatio) * 100), unit: "% contour contrast", confidence: "low", source: "2d_proxy" }),
    trait({ id: "chin_philtrum_ratio", en: "Chin-to-Philtrum Ratio", pt: "Relação queixo-filtro", score: chinPhiltrumScore, raw: round(chinPhiltrumRatio), unit: "ratio", confidence: "medium", source: "anthropometry" }),
    trait({ id: "lower_third", en: "Lower Facial Third", pt: "Terço facial inferior", score: lowerThirdScore, raw: round(lowerThird), unit: "%", confidence: "medium", source: "anthropometry" }),
    trait({ id: "mouth_nose_ratio", en: "Mouth-to-Nose Width Ratio", pt: "Relação largura boca-nariz", score: mouthNoseScore, raw: round(mouthNoseRatio), unit: "ratio", confidence: "high", source: "anthropometry" }),
    trait({ id: "nose_width_height", en: "Nasal Width-to-Height Ratio", pt: "Relação largura-altura nasal", score: noseScore, raw: round(noseWidthHeightRatio), unit: "ratio", confidence: "medium", source: "anthropometry" }),
    trait({ id: "lip_ratio", en: "Lower-to-Upper Lip Ratio", pt: "Relação lábio inferior-superior", score: lipScore, raw: round(lipRatio), unit: "ratio", confidence: "medium", source: "geometry" }),
    trait({ id: "face_shape", en: "Face Shape", pt: "Formato facial", score: harmony, raw: shape.label, confidence: "medium", source: "contour_classification" }),
    trait({ id: "relative_nasal_depth", en: "Relative Nasal Depth Proxy", pt: "Proxy de profundidade nasal relativa", score: depthSignals.zUsable ? nasalDepthScore : null, raw: depthSignals.zUsable ? depthSignals.nasalProjection : "Z_UNAVAILABLE", unit: "% face width", confidence: depthSignals.depthConfidence >= 65 ? "medium" : "low", source: depthSignals.zUsable ? depthSignals.source : "not_measured", note: "Profundidade relativa do modelo 3D; não equivale a milímetros." }),
    trait({ id: "relative_chin_depth", en: "Relative Chin Depth Proxy", pt: "Proxy de profundidade relativa do queixo", score: depthSignals.zUsable ? chinDepthScore : null, raw: depthSignals.zUsable ? depthSignals.chinProjection : "Z_UNAVAILABLE", unit: "% face width", confidence: depthSignals.depthConfidence >= 65 ? "medium" : "low", source: depthSignals.zUsable ? depthSignals.source : "not_measured", note: "Superfície estimada; não mede projeção óssea clínica." }),
    trait({ id: "gonial_surface_3d", en: "3D Surface Gonial Proxy", pt: "Proxy 3D superficial do ângulo goníaco", score: depthSignals.zUsable ? surfaceGonialScore : null, raw: depthSignals.zUsable ? depthSignals.surfaceGonialAngle : "DEPTH_REQUIRED", unit: "° surface mesh", confidence: "low", source: depthSignals.zUsable ? depthSignals.source : "not_measured", note: "Ângulo da malha de tecido mole. Não é o ângulo goníaco anatômico obtido por cefalometria." }),
    trait({ id: "ramus_surface", en: "Ramus-Surface Length Proxy", pt: "Proxy superficial do comprimento do ramo", score: depthSignals.zUsable ? ramusSurfaceScore : null, raw: depthSignals.zUsable ? depthSignals.ramusSurfaceRatio : "DEPTH_REQUIRED", unit: "% face height", confidence: "low", source: depthSignals.zUsable ? depthSignals.source : "not_measured", note: "Distância na malha entre região lateral e contorno mandibular; não mede o osso." }),
    trait({ id: "cervicomental", en: "Photographic Cervicomental Angle Proxy", pt: "Proxy fotográfico do ângulo cervicomentoniano", score: cervicomentalScore, raw: neckMeasurementUsable ? depthSignals.neckSignal.angle : depthSignals.neckSignal?.reason || "PROFILE_NECK_MASK_REQUIRED", unit: "° photographic", confidence: depthSignals.neckSignal?.confidence >= 65 ? "medium" : depthSignals.neckSignal?.confidence >= 35 ? "low" : "unsupported", source: neckMeasurementUsable ? "face_body_skin_segmentation_proxy" : "not_measured", note: neckMeasurementUsable ? `Face-skin/body-skin boundary; confidence ${round(depthSignals.neckSignal.confidence)}%. Não é cefalometria nem diagnóstico.` : "Exige perfil lateral, ombros visíveis e linha sob o queixo sem cabelo, barba densa, gola ou acessórios." }),
    trait({ id: "orbital_support_depth", en: "Orbital-Support Depth Proxy", pt: "Proxy de suporte orbital em profundidade", score: depthSignals.zUsable ? orbitalSupportScore : null, raw: depthSignals.zUsable ? depthSignals.orbitalSupport : "DEPTH_REQUIRED", unit: "% face width", confidence: "low", source: depthSignals.zUsable ? depthSignals.source : "not_measured", note: "Diferença relativa entre superfície ocular e infraorbital; não é vetor orbital clínico." }),
    trait({ id: "soft_tissue_definition", en: "Soft-Tissue Definition Proxy", pt: "Proxy de definição de tecido mole", score: softTissueDefinition, raw: round(softTissueDefinition), unit: "% contour definition", confidence: "low", source: "2d_3d_composite_proxy", note: "Descreve contorno e transições superficiais; não estima gordura corporal nem saúde." }),
  ];

  const attractionDrivers = modeAnalysis.drivers;
  const potential = buildPotential({ shape, eyeArea: eyeAreaScore, jawline: jawlineScore, featureBalance, captureConfidence });

  return {
    version: 5,
    analyzedAt: new Date().toISOString(),
    sourceType: options.sourceType || "unknown",
    presentationTarget,
    faceShape: shape,
    psl: {
      score: pslScore,
      estimatedRange,
      scale: 8,
      tier,
      confidence: captureConfidence,
      penalty: modeAnalysis.totalPenalty,
      formula: modeAnalysis.formula,
      components,
      calibration: {
        version: "community_balanced_piecewise_v5",
        weightedPercent: modeAnalysis.weightedPercent,
        calibratedBasePsl,
        preGatePsl: round(preGatePsl, 2),
        weakestCoreComponent: round(weakestCoreComponent, 1),
        tierCap: tierCap < 8 ? tierCap : null,
        gateReasons,
        reliabilityWarnings,
      },
      disclaimer: "PSL-inspired heuristic; no universal or scientifically validated PSL formula exists.",
    },
    scores: {
      geometryIndex,
      symmetry,
      eyeBalance,
      communityAlignment: round(featureBalance, 1),
      harmony: round(harmony, 1),
      dimorphism: round(dimorphism, 1),
      angularity: round(angularity, 1),
      featureBalance: round(featureBalance, 1),
      modeScore: modeAnalysis.weightedPercent,
      captureConfidence,
    },
    modeAnalysis: {
      id: presentationTarget,
      label: targetLabelsForEngine(presentationTarget),
      classifications: modeAnalysis.classifications,
      penalties: modeAnalysis.penalties,
      measuredWeight: components.filter((item) => item.scorePercent !== null).reduce((sum, item) => sum + item.weight, 0),
    },
    visualSignals: {
      method: "adapted_michelson_plus_cielab_feature_regions",
      sampleCount: imageSignals.sampleCount ?? (Number.isFinite(imageSignals.facialContrast) ? 1 : 0),
      skinHomogeneity: Number.isFinite(imageSignals.skinHomogeneity) ? round(imageSignals.skinHomogeneity, 1) : null,
      facialContrast: Number.isFinite(imageSignals.facialContrast) ? round(imageSignals.facialContrast, 1) : null,
      luminanceContrast: Number.isFinite(imageSignals.luminanceContrast) ? round(imageSignals.luminanceContrast, 2) : null,
      colorContrastDeltaE: Number.isFinite(imageSignals.colorContrastDeltaE) ? round(imageSignals.colorContrastDeltaE, 2) : null,
      eyeContrast: Number.isFinite(imageSignals.eyeContrast) ? round(imageSignals.eyeContrast, 2) : null,
      browContrast: Number.isFinite(imageSignals.browContrast) ? round(imageSignals.browContrast, 2) : null,
      mouthContrast: Number.isFinite(imageSignals.mouthContrast) ? round(imageSignals.mouthContrast, 2) : null,
      contrastConfidence: Number.isFinite(imageSignals.contrastConfidence) ? round(imageSignals.contrastConfidence, 1) : null,
      lightingUniformity: Number.isFinite(imageSignals.lightingUniformity) ? round(imageSignals.lightingUniformity, 1) : null,
      skinSignalUsable,
      contrastSignalUsable,
    },
    dimensionAudit: {
      twoDimensional: {
        status: "measured",
        confidence: captureConfidence,
        basis: "478 landmarks + pixel regions",
      },
      depthProxy: {
        status: depthSignals.zUsable ? "measured_as_relative_proxy" : "unavailable",
        confidence: round(depthSignals.depthConfidence, 1),
        source: depthSignals.source,
        poseCoverage: round(depthSignals.poseCoverage, 1),
        completedSteps: depthSignals.completedSteps,
        sampleCount: depthSignals.sampleCount,
        transformationMatrixSamples: depthSignals.matrixSamples,
        yawSpan: depthSignals.yawSpan,
        pitchSpan: depthSignals.pitchSpan,
        metricScale: false,
        neckSegmentation: depthSignals.neckSignal,
      },
      limitation: "RGB webcam depth is model-relative and non-metric; clinical or millimetric 3D requires calibrated stereo, structured light, LiDAR or a validated 3D scanner.",
    },
    traits,
    metrics: traits.filter((item) => item.rawValue !== null).map((item) => ({
      id: item.id,
      label: `${item.termEn} / ${item.termPt}`,
      value: item.rawValue,
      unit: item.unit,
      confidence: item.confidence,
      source: item.source,
    })),
    attractionDrivers,
    potential,
    notes: [
      "PSL e tiers são taxonomia cultural de fóruns, não medição científica de beleza.",
      "2D e profundidade relativa da malha não medem estrutura óssea, gordura corporal, saúde, ancestralidade ou personalidade.",
      "Contraste usa Michelson adaptado e CIELAB em regiões de olhos, sobrancelhas e boca; luz e maquiagem alteram a leitura.",
      "O cervicomentoniano fotográfico usa perfil e fronteira face-skin/body-skin; medida clínica real exige protocolo validado e não é fornecida.",
      "Preferências de rostos variam significativamente entre indivíduos e culturas.",
    ],
  };
}

export function analyzeLandmarkSamples(samples, options = {}) {
  const frontSamples = samples.filter((sample) => sample.step === 0);
  const selected = frontSamples.length >= 3 ? frontSamples : samples;
  const aspectRatio = options.aspectRatio || 1;
  const points = medianLandmarks(selected, aspectRatio);
  if (!points) throw new Error("Nenhuma amostra frontal válida foi capturada.");
  const confidence = clamp(58 + selected.length * 2.2, 58, 96);
  const depthSignals = summarizeMultiView(samples, aspectRatio);
  depthSignals.neckSignal = options.neckSignal || null;
  return analyzeLandmarks(points, {
    aspectRatio: 1,
    sourceType: options.sourceType || "guided_scan",
    presentationTarget: options.presentationTarget || "neutral",
    confidence,
    imageSignals: options.imageSignals,
    depthSignals,
  });
}

export function compareAnalyses(primary, challenger) {
  return {
    primary: { psl: primary.psl?.score, tier: primary.psl?.tier },
    challenger: { psl: challenger.psl?.score, tier: challenger.psl?.tier },
  };
}

export { tierForPsl, toPsl as calibratePslScore };
