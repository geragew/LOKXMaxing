const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, precision = 2) => Number(value.toFixed(precision));

function fitLine(points) {
  if (points.length < 6) return null;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  points.forEach((point) => {
    const x = point.x - meanX;
    const y = point.y - meanY;
    xx += x * x;
    xy += x * y;
    yy += y * y;
  });
  const trace = xx + yy;
  const root = Math.sqrt(Math.max(0, (xx - yy) ** 2 + 4 * xy ** 2));
  const major = (trace + root) / 2;
  const minor = (trace - root) / 2;
  if (major <= 0.0001) return null;
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy) * (180 / Math.PI);
  return {
    angle: (angle + 180) % 180,
    linearity: clamp(1 - minor / major, 0, 1),
    center: { x: meanX, y: meanY },
  };
}

function hasCategoryNearby(mask, width, height, x, y, category, radius = 2) {
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      const sampleX = x + offsetX;
      const sampleY = y + offsetY;
      if (sampleX < 0 || sampleY < 0 || sampleX >= width || sampleY >= height) continue;
      if (mask[sampleY * width + sampleX] === category) return true;
    }
  }
  return false;
}

function poseFromFaceLandmarks(landmarks) {
  const left = landmarks[234];
  const right = landmarks[454];
  const nose = landmarks[1];
  const width = Math.max(Math.abs(right.x - left.x), 0.0001);
  return {
    faceWidth: width,
    yaw: (nose.x - (left.x + right.x) / 2) / width,
    direction: nose.x >= (left.x + right.x) / 2 ? 1 : -1,
  };
}

export function extractCervicomentalSignal(categoryMask, maskWidth, maskHeight, landmarks) {
  if (!categoryMask?.length || !maskWidth || !maskHeight || !landmarks?.[152]) {
    return { status: "unavailable", reason: "MASK_OR_LANDMARKS_MISSING", confidence: 0 };
  }
  const pose = poseFromFaceLandmarks(landmarks);
  const chin = { x: landmarks[152].x * maskWidth, y: landmarks[152].y * maskHeight };
  const faceWidthPx = pose.faceWidth * maskWidth;
  const xBehind = chin.x - pose.direction * faceWidthPx * 0.62;
  const roiMinX = Math.max(0, Math.floor(Math.min(chin.x, xBehind) - faceWidthPx * 0.08));
  const roiMaxX = Math.min(maskWidth - 1, Math.ceil(Math.max(chin.x, xBehind) + faceWidthPx * 0.08));
  const roiMinY = Math.max(0, Math.floor(chin.y - maskHeight * 0.035));
  const roiMaxY = Math.min(maskHeight - 1, Math.ceil(chin.y + maskHeight * 0.34));
  const submentalPoints = [];
  const neckPoints = [];

  for (let y = roiMinY; y <= roiMaxY; y += 1) {
    const bodyPixels = [];
    for (let x = roiMinX; x <= roiMaxX; x += 1) {
      const category = categoryMask[y * maskWidth + x];
      if (category === 3 && hasCategoryNearby(categoryMask, maskWidth, maskHeight, x, y, 2, 2)) {
        submentalPoints.push({ x, y });
      }
      if (category === 2) bodyPixels.push(x);
    }
    if (bodyPixels.length && y >= chin.y + maskHeight * 0.035) {
      const anteriorX = pose.direction > 0 ? Math.max(...bodyPixels) : Math.min(...bodyPixels);
      const externalNeighborX = anteriorX + pose.direction * 2;
      const externalCategory = externalNeighborX >= 0 && externalNeighborX < maskWidth
        ? categoryMask[y * maskWidth + externalNeighborX] : 0;
      if ([0, 4, 5].includes(externalCategory)) neckPoints.push({ x: anteriorX, y });
    }
  }

  const submentalLine = fitLine(submentalPoints);
  const neckLine = fitLine(neckPoints);
  if (!submentalLine || !neckLine) {
    return {
      status: "unavailable",
      reason: "NECK_CONTOUR_NOT_RESOLVED",
      confidence: 0,
      boundaryPoints: { submental: submentalPoints.length, neck: neckPoints.length },
    };
  }

  let difference = Math.abs(submentalLine.angle - neckLine.angle) % 180;
  if (difference > 90) difference = 180 - difference;
  const angle = 180 - difference;
  const poseQuality = clamp((Math.abs(pose.yaw) - 0.045) / 0.12, 0, 1);
  const pointQuality = clamp(Math.min(submentalPoints.length, neckPoints.length) / 32, 0, 1);
  const lineQuality = Math.sqrt(submentalLine.linearity * neckLine.linearity);
  const anatomicalRangeQuality = angle >= 70 && angle <= 160 ? 1 : 0.35;
  const confidence = clamp((poseQuality * 0.3 + pointQuality * 0.25 + lineQuality * 0.35 + anatomicalRangeQuality * 0.1) * 100, 0, 92);

  return {
    status: confidence >= 45 ? "measured_photographic_proxy" : "low_confidence",
    angle: round(angle, 1),
    confidence: round(confidence, 1),
    submentalLineAngle: round(submentalLine.angle, 1),
    neckLineAngle: round(neckLine.angle, 1),
    yawProxy: round(pose.yaw, 3),
    boundaryPoints: { submental: submentalPoints.length, neck: neckPoints.length },
    source: "selfie_multiclass_face_skin_body_skin_boundary",
    reason: confidence >= 45 ? null : "PROFILE_OR_MASK_CONFIDENCE_LOW",
  };
}

export function aggregateCervicomentalSignals(signals) {
  const usable = signals.filter((signal) => Number.isFinite(signal?.angle) && signal.confidence >= 35);
  if (!usable.length) return signals.at(-1) || { status: "unavailable", reason: "NO_PROFILE_SAMPLE", confidence: 0 };
  const weightedTotal = usable.reduce((sum, signal) => sum + signal.confidence, 0);
  const angle = usable.reduce((sum, signal) => sum + signal.angle * signal.confidence, 0) / Math.max(weightedTotal, 0.001);
  const confidence = usable.reduce((sum, signal) => sum + signal.confidence, 0) / usable.length;
  return {
    ...usable.sort((a, b) => b.confidence - a.confidence)[0],
    status: confidence >= 45 ? "measured_photographic_proxy" : "low_confidence",
    angle: round(angle, 1),
    confidence: round(confidence, 1),
    sampleCount: usable.length,
  };
}
