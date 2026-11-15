// Builds a synthetic "photo" (rotated A4 sheet + foot-shaped blob of known size) and checks the pipeline.
process.env.BLUR_MIN = '1'; // synthetic image is flat, so its Laplacian variance is low
const fs = require('fs');
const sharp = require('sharp');
const { measureFoot } = require('../src/cv/pipeline');

const PX = 700 / 210, LEN = 250;
const halfW = (t) => 46 * Math.sqrt(Math.sin(Math.PI * Math.min(Math.max(t, 0.001), 0.999))) * (0.8 + 0.2 * t); // mm
const left = [], right = [];
let maxW = 0;
for (let i = 0; i <= 200; i++) {
  const t = i / 200, y = (0.5 - t) * LEN * PX, w = halfW(t);
  maxW = Math.max(maxW, 2 * w);
  left.push(`${(-w * PX).toFixed(1)},${y.toFixed(1)}`); right.unshift(`${(w * PX).toFixed(1)},${y.toFixed(1)}`);
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200">
 <rect width="1600" height="1200" fill="#2b2b2b"/>
 <g transform="translate(800,600) rotate(5)">
  <rect x="-350" y="-495" width="700" height="990" fill="#f4f4f2"/>
  <polygon points="${[...left, ...right].join(' ')}" fill="#b08968"/>
 </g></svg>`;

(async () => {
  const photo = await sharp(Buffer.from(svg)).blur(0.8).jpeg({ quality: 90 }).toBuffer();
  const r = await measureFoot(photo);
  fs.writeFileSync('/tmp/overlay.jpg', Buffer.from(r.overlay.split(',')[1], 'base64'));
  console.log('truth    : length', LEN, 'mm, max width', maxW.toFixed(1), 'mm');
  console.log('measured :', r.measurements, 'paper', r.paper, 'sharp', r.sharpness, 'conf', r.confidence);
  const err = Math.abs(r.measurements.lengthMm - LEN);
  console.log(err <= 3 ? 'PASS' : 'FAIL', `(length error ${err.toFixed(1)} mm)`);
  process.exit(err <= 3 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
