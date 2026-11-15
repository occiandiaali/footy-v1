const router = require('express').Router();
const multer = require('multer');
const { measureFoot, GuidanceError } = require('../cv/pipeline');

const upload = multer({
  storage: multer.memoryStorage(),           // raw photos are never written to disk
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype)),
});

router.get('/', (req, res) => res.render('index'));

router.post('/measure', upload.single('photo'), async (req, res) => {
  const fail = (status, message, tip) => res.status(status).render('partials/error', { message, tip });
  if (!req.file) return fail(422, 'No photo received.', 'Take a photo with the camera, or choose a JPEG/PNG image.');
  const side = req.body.side === 'right' ? 'right' : 'left';
  try {
    const result = await measureFoot(req.file.buffer);
    res.render('partials/result', { r: result, side });
  } catch (e) {
    if (e instanceof GuidanceError) return fail(422, e.message, e.tip);
    console.error(e);
    fail(500, 'Something went wrong while measuring.', 'Please try again with a new photo.');
  }
});

module.exports = router;
