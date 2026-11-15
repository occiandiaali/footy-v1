const $ = (s) => document.querySelector(s);
const video = $('#video'), canvas = $('#canvas'), fileInput = $('#photo'), form = $('#capture-form');

// Let HTMX swap guidance (422) and error (500) partials into the page.
document.body.addEventListener('htmx:beforeSwap', (e) => {
  const s = e.detail.xhr.status;
  if (s === 422 || s === 500) { e.detail.shouldSwap = true; e.detail.isError = false; }
});

$('#start').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    video.srcObject = stream;
    $('#camera').hidden = false;
    $('#start').hidden = true;
    $('#camera-msg').textContent = '';
  } catch (err) {
    $('#camera-msg').textContent = 'Camera unavailable (' + err.name + '). Use “Upload a photo” instead.';
  }
});

$('#snap').addEventListener('click', () => {
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  canvas.toBlob((blob) => {
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'foot.jpg', { type: 'image/jpeg' }));
    fileInput.files = dt.files;
    htmx.trigger(form, 'submit');
  }, 'image/jpeg', 0.92);
});

fileInput.addEventListener('change', () => { if (fileInput.files.length) htmx.trigger(form, 'submit'); });
