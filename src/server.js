const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/htmx', express.static(path.join(__dirname, '..', 'node_modules', 'htmx.org', 'dist')));
app.use('/', require('./routes/capture'));

// multer errors (file too large etc.)
app.use((err, req, res, next) => {
  res.status(422).render('partials/error', { message: 'That file could not be used.', tip: 'Use a photo under 15 MB.' });
});

const port = process.env.PORT || 3000;
// getUserMedia needs HTTPS (except on localhost). Set TLS_KEY / TLS_CERT to test from a phone.
if (process.env.TLS_KEY && process.env.TLS_CERT) {
  require('https').createServer({ key: fs.readFileSync(process.env.TLS_KEY), cert: fs.readFileSync(process.env.TLS_CERT) }, app)
    .listen(port, () => console.log(`https://localhost:${port}`));
} else {
  app.listen(port, () => console.log(`http://localhost:${port}`));
}
