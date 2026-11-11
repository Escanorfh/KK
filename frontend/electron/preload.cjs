// Desktop: point the frontend at the deployed EFMS backend (same origin as the web app).
// The Vercel rewrite sends /api/* to the backend service.
try {
  if (!localStorage.getItem("efms_server_url")) {
    localStorage.setItem("efms_server_url", "https://efms-kk.vercel.app");
  }
} catch (e) {}
