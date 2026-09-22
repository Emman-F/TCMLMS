/* =====================================================================
   INIT.JS — the one line that actually starts the app. Loaded LAST
   (see index.html) — by this point core/admin/instructor/student have
   all already defined every function the app needs.
   ===================================================================== */
/* ============================= INIT ============================= */
loadDB().then(renderApp);
