'use strict';
// Metronome sync server location. Workers are deployed by .github/workflows/deploy-sync-server.yml.
// `subdomain` is the Cloudflare account's workers.dev subdomain
// (Cloudflare dashboard → Workers & Pages → your subdomain is shown as <name>.workers.dev).
// Leave it empty and "Metronome sync" says the server isn't set up yet.
window.GM_SYNC_CONFIG = {
  subdomain: 'dev-chehok',
  // Sites that use the production server; any other host uses the stage server. That includes
  // stage.guitar-mate.pages.dev and guitar-mate.dev-chehok.workers.dev, which serves the stage branch.
  productionHosts: ['guitar-mate.pages.dev'],
  productionWorker: 'guitar-mate-sync',
  stageWorker: 'guitar-mate-sync-stage',
};
