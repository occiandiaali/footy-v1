// Lazy, one-time OpenCV (WASM) initialisation. Usage: const { cv } = await getCV();
let ready;
module.exports = function getCV() {
  if (!ready) {
    ready = (async () => {
      let cv = require('@techstark/opencv-js');
      if (cv instanceof Promise) cv = await cv;
      if (!cv.Mat) await new Promise((r) => { cv.onRuntimeInitialized = r; });
      return { cv }; // wrapped: the cv module itself must not be resolved as a thenable
    })();
  }
  return ready;
};
