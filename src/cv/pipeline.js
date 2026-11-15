const sharp = require('sharp');
const getCV = require('./opencv');

const PX_PER_MM = 4;                 // scale of the rectified (top-down) image
const MAX_DIM = 1600;                // downscale big phone photos before CV
const BLUR_MIN = Number(process.env.BLUR_MIN || 40); // variance-of-Laplacian floor
const EDGE_MARGIN_MM = 10;           // ignore the paper's outer rim when segmenting
const PAPERS = { A4: { w: 210, h: 297 }, Letter: { w: 215.9, h: 279.4 } };

class GuidanceError extends Error {
  constructor(message, tip) { super(message); this.tip = tip; }
}
const clamp01 = (x) => Math.max(0, Math.min(1, x));

async function measureFoot(buffer) {
  const { cv } = await getCV();
  const trash = [];
  const keep = (m) => { trash.push(m); return m; };
  try {
    // 1. Decode (EXIF-rotate, downscale) -> RGBA Mat
    const { data, info } = await sharp(buffer).rotate()
      .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const src = keep(cv.matFromImageData({ data: new Uint8ClampedArray(data), width: info.width, height: info.height }));
    const gray = keep(new cv.Mat());
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // 2. Quality gate: blur
    const sharpness = laplacianVariance(cv, gray, keep);
    if (sharpness < BLUR_MIN) {
      throw new GuidanceError('The photo is too blurry.', 'Hold the phone steady, tap to focus on the paper, and make sure the room is well lit.');
    }

    // 3. Find the paper and rectify to a top-down, mm-scaled view
    const { quad, paperType, deviation } = findPaper(cv, gray, keep, info);
    const dims = PAPERS[paperType];
    const W = Math.round(dims.w * PX_PER_MM), H = Math.round(dims.h * PX_PER_MM);
    const srcPts = keep(cv.matFromArray(4, 1, cv.CV_32FC2, quad.flatMap((p) => [p.x, p.y])));
    const dstPts = keep(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, W, 0, W, H, 0, H]));
    const M = keep(cv.getPerspectiveTransform(srcPts, dstPts));
    const warped = keep(new cv.Mat());
    cv.warpPerspective(src, warped, M, new cv.Size(W, H), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    // 4. Segment the foot (darker than paper) inside the paper's inner area
    const m = EDGE_MARGIN_MM * PX_PER_MM;
    const roiRect = new cv.Rect(m, m, W - 2 * m, H - 2 * m);
    const roi = keep(warped.roi(roiRect));
    const g2 = keep(new cv.Mat()), mask = keep(new cv.Mat());
    cv.cvtColor(roi, g2, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(g2, g2, new cv.Size(9, 9), 0);
    cv.threshold(g2, mask, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
    const open = keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5)));
    const close = keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(15, 15)));
    cv.morphologyEx(mask, mask, cv.MORPH_OPEN, open);
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, close);

    const cs = keep(new cv.MatVector()), hier = keep(new cv.Mat());
    cv.findContours(mask, cs, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);
    const bi = largestContour(cv, cs);
    if (bi < 0 || cv.contourArea(cs.get(bi)) < 0.04 * roi.rows * roi.cols) {
      throw new GuidanceError('No foot found on the paper.', 'Stand with one bare or sock-clad foot flat on the paper. A dark sock gives the best result.');
    }
    const cnt = keep(cs.get(bi));
    const br = cv.boundingRect(cnt);
    if (br.x <= 2 || br.y <= 2 || br.x + br.width >= roi.cols - 2 || br.y + br.height >= roi.rows - 2) {
      throw new GuidanceError('Your foot reaches the edge of the paper.', 'The whole foot, including toes and heel, must sit fully inside the sheet with a small gap all round.');
    }

    // 5. Measure
    const pts = [];
    for (let i = 0; i < cnt.data32S.length; i += 2) pts.push([cnt.data32S[i] + m, cnt.data32S[i + 1] + m]);
    const meas = measureContour(pts);
    const hull = keep(new cv.Mat());
    cv.convexHull(cnt, hull, false, true);
    const solidity = cv.contourArea(cnt) / cv.contourArea(hull);

    // 6. Overlay for the user to sanity-check
    const vis = keep(warped.clone());
    const view = keep(vis.roi(roiRect));
    const vec = keep(new cv.MatVector()); vec.push_back(cnt);
    cv.drawContours(view, vec, 0, new cv.Scalar(0, 170, 90, 255), 2);
    const P = (u, v) => new cv.Point(Math.round(meas.mx + u * meas.ux + v * meas.vx), Math.round(meas.my + u * meas.uy + v * meas.vy));
    cv.line(vis, P(meas.heelU, 0), P(meas.toeU, 0), new cv.Scalar(242, 194, 48, 255), 3);
    cv.line(vis, P(meas.ballU, meas.ballLo), P(meas.ballU, meas.ballHi), new cv.Scalar(220, 60, 60, 255), 3);
    const overlay = (await sharp(Buffer.from(vis.data), { raw: { width: W, height: H, channels: 4 } })
      .resize({ height: 640 }).jpeg({ quality: 80 }).toBuffer()).toString('base64');

    const confidence = 0.4 * clamp01((solidity - 0.85) / 0.1) + 0.3 * clamp01(sharpness / 150) + 0.3 * clamp01(1 - deviation / 0.06);
    const mm = (px) => Math.round((px / PX_PER_MM) * 10) / 10;
    return {
      measurements: {
        lengthMm: mm(meas.length),
        ballWidthMm: mm(meas.ballWidth),
        heelWidthMm: mm(meas.heelWidth),
        ballPositionPct: Math.round(meas.ballT * 100),
      },
      paper: { type: paperType, deviation: Math.round(deviation * 1000) / 1000 },
      sharpness: Math.round(sharpness),
      confidence: Math.round(confidence * 100) / 100,
      overlay: `data:image/jpeg;base64,${overlay}`,
    };
  } finally {
    trash.forEach((t) => { try { t.delete(); } catch (_) {} });
  }
}

function laplacianVariance(cv, gray, keep) {
  const lap = keep(new cv.Mat()), mu = keep(new cv.Mat()), sd = keep(new cv.Mat());
  cv.Laplacian(gray, lap, cv.CV_64F);
  cv.meanStdDev(lap, mu, sd);
  return sd.data64F[0] ** 2;
}

function largestContour(cv, cs) {
  let best = -1, area = 0;
  for (let i = 0; i < cs.size(); i++) {
    const c = cs.get(i); const a = cv.contourArea(c); c.delete();
    if (a > area) { area = a; best = i; }
  }
  return best;
}

// Paper = the largest bright region. Convex hull makes it robust to the foot overlapping an edge.
function findPaper(cv, gray, keep, info) {
  const blur = keep(new cv.Mat()), bw = keep(new cv.Mat());
  cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
  cv.threshold(blur, bw, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
  const cs = keep(new cv.MatVector()), hier = keep(new cv.Mat());
  cv.findContours(bw, cs, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  const bi = largestContour(cv, cs);
  const fail = new GuidanceError("Couldn't find the sheet of paper.",
    'Place a white A4 or Letter sheet on a darker floor, and keep all four corners in view.');
  if (bi < 0) throw fail;
  const cnt = keep(cs.get(bi));
  if (cv.contourArea(cnt) < 0.12 * info.width * info.height) throw fail;

  const hull = keep(new cv.Mat()), ap = keep(new cv.Mat());
  cv.convexHull(cnt, hull, false, true);
  cv.approxPolyDP(hull, ap, 0.02 * cv.arcLength(hull, true), true);
  let pts;
  if (ap.rows === 4) pts = [0, 1, 2, 3].map((i) => ({ x: ap.data32S[2 * i], y: ap.data32S[2 * i + 1] }));
  else pts = cv.RotatedRect.points(cv.minAreaRect(hull)).map((p) => ({ x: p.x, y: p.y }));

  // order clockwise around the centroid, then start so edge 0->1 is a SHORT side
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4, cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  pts.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  if (d(pts[0], pts[1]) > d(pts[1], pts[2])) pts.push(pts.shift());
  const shortSide = (d(pts[0], pts[1]) + d(pts[2], pts[3])) / 2;
  const longSide = (d(pts[1], pts[2]) + d(pts[3], pts[0])) / 2;
  const ratio = longSide / shortSide;

  let paperType = null, deviation = Infinity;
  for (const [name, p] of Object.entries(PAPERS)) {
    const dev = Math.abs(ratio - p.h / p.w) / (p.h / p.w);
    if (dev < deviation) { deviation = dev; paperType = name; }
  }
  if (deviation > 0.08) {
    throw new GuidanceError('The paper looks distorted or partly hidden.', 'Hold the camera more directly above the sheet and make sure no corner is covered.');
  }
  return { quad: pts, paperType, deviation };
}

// PCA axis + width profile from the (dense) outline points; all values in rectified pixels.
function measureContour(pts) {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  let cxx = 0, cyy = 0, cxy = 0;
  for (const [x, y] of pts) { cxx += (x - mx) ** 2; cyy += (y - my) ** 2; cxy += (x - mx) * (y - my); }
  const th = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const ux = Math.cos(th), uy = Math.sin(th), vx = -uy, vy = ux;
  const proj = pts.map(([x, y]) => [(x - mx) * ux + (y - my) * uy, -(x - mx) * uy + (y - my) * ux]);
  const umin = Math.min(...proj.map((p) => p[0])), umax = Math.max(...proj.map((p) => p[0]));
  const length = umax - umin;

  const N = 100;
  let bins = Array.from({ length: N }, () => ({ lo: Infinity, hi: -Infinity }));
  for (const [u, v] of proj) {
    const b = bins[Math.min(N - 1, Math.floor(((u - umin) / length) * N))];
    b.lo = Math.min(b.lo, v); b.hi = Math.max(b.hi, v);
  }
  bins.forEach((b, i) => { if (!isFinite(b.lo)) Object.assign(b, i ? bins[i - 1] : { lo: 0, hi: 0 }); });
  const wOf = (b) => b.hi - b.lo;
  const avg = (a, b) => { let s = 0, k = 0; for (let i = Math.floor(a * N); i < Math.floor(b * N); i++) { s += wOf(bins[i]); k++; } return s / k; };

  // The forefoot is wider than the rear foot: use that to decide which end is the heel.
  const flipped = avg(0.55, 0.8) < avg(0.2, 0.45);
  if (flipped) bins = bins.reverse();
  const tToU = (t) => (flipped ? umax - t * length : umin + t * length);

  let bi = Math.floor(0.55 * N);
  for (let i = bi; i < Math.floor(0.8 * N); i++) if (wOf(bins[i]) > wOf(bins[bi])) bi = i;
  const ballT = (bi + 0.5) / N;
  return {
    mx, my, ux, uy, vx, vy, length, ballT,
    ballWidth: wOf(bins[bi]), ballLo: bins[bi].lo, ballHi: bins[bi].hi, ballU: tToU(ballT),
    heelWidth: avg(0.15, 0.2), heelU: tToU(0), toeU: tToU(1),
  };
}

module.exports = { measureFoot, GuidanceError };
