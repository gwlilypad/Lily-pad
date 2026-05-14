const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

const SUPABASE_URL = 'https://mcfxoimaqgpyntvasbsw.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || '';

const INLINE_CSS = `
  /* Applied inline — no file load, no caching issues */
  .home-icon-btn { display: none !important; }
  #root { transition: opacity 0.3s ease; }
`;

app.get('/', (req, res) => {
  let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

  const headInjection = `
  <style id="lily-overrides">${INLINE_CSS}</style>
  <link rel="stylesheet" href="/auth.css">
  <script>
    window.__SUPABASE_URL__ = "${SUPABASE_URL}";
    window.__SUPABASE_ANON_KEY__ = "${SUPABASE_ANON_KEY}";
  </script>`;

  html = html.replace('</head>', `${headInjection}</head>`);

  const authOverlay = fs.readFileSync(path.join(__dirname, 'auth-overlay.html'), 'utf8');
  html = html.replace('<div id="root"></div>', `${authOverlay}<div id="root"></div>`);
  html = html.replace('</body>', `<script src="/auth.js"></script></body>`);

  res.send(html);
});

app.use(express.static(__dirname));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Lily Pad server running on port ${PORT}`);
});
