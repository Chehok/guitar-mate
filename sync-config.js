'use strict';
// Metronome sync server location. Workers are deployed by .github/workflows/deploy-sync-server.yml.
// `subdomain` is the Cloudflare account's workers.dev subdomain
// (Cloudflare dashboard → Workers & Pages → your subdomain is shown as <name>.workers.dev).
// Leave it empty and "Play together" says the server isn't set up yet.
window.GM_SYNC_CONFIG = {
  subdomain: 'dev-chehok',
  // Sites that use the production server; any other host (stage and previews) uses the stage server.
  productionHosts: ['guitar-mate.pages.dev', 'guitar-mate.dev-chehok.workers.dev'],
  productionWorker: 'guitar-mate-sync',
  stageWorker: 'guitar-mate-sync-stage',
};
