# foot-measure (scaffold)

Node + Express + EJS + HTMX. Photo of one foot on A4/Letter paper -> length, ball width, heel width.

    npm install
    npm start          # http://localhost:3000
    npm test           # synthetic end-to-end check of the CV pipeline

Phone testing needs HTTPS for the camera: set TLS_KEY and TLS_CERT (e.g. made with mkcert) and open https://<lan-ip>:3000.
Tune the blur gate with BLUR_MIN (default 40).
