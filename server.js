const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

const SUPABASE_URL = 'https://mcfxoimaqgpyntvasbsw.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || '';

app.get('/', (req, res) => {
  let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const authJS  = fs.readFileSync(path.join(__dirname, 'auth.js'), 'utf8');
  const authCSS = fs.readFileSync(path.join(__dirname, 'auth.css'), 'utf8');
  const authOverlay = fs.readFileSync(path.join(__dirname, 'auth-overlay.html'), 'utf8');

  // Inline everything — zero external file requests, zero caching issues
  const headInjection = `
  <style id="lily-auth-css">${authCSS}</style>
  <style id="lily-overrides">
    .home-icon-btn { display: none !important; }
  </style>
  <script>
    window.__SUPABASE_URL__ = "${SUPABASE_URL}";
    window.__SUPABASE_ANON_KEY__ = "${SUPABASE_ANON_KEY}";
  </script>`;

  html = html.replace('</head>', `${headInjection}</head>`);
  html = html.replace('<div id="root"></div>', `${authOverlay}<div id="root"></div>`);
  const debugMode = req.query.debug === '1';
  const debugScript = debugMode ? `<script>window.__LP_DEBUG__ = true;</script>` : '';
  html = html.replace('</body>', `${debugScript}<script>${authJS}</script></body>`);

  // No caching on the main page
  res.setHeader('Cache-Control', 'no-store');
  res.send(html);
});

// Static files (assets) can still be cached by the browser
app.use(express.static(__dirname));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Lily Pad server running on port ${PORT}`);
});
