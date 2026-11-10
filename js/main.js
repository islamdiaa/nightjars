import { installErrorReporter } from './ui/playtest.js';

// JS errors -> /api/error (playtest log). The app is imported dynamically below so that even a
// module that fails to load (a syntax error anywhere in the engine) is caught, shown and reported.
installErrorReporter();

// Boot: load the campaign data, then hand over to the App.
async function boot() {
  const root = document.getElementById('app');
  try {
    const [{ App }, campaign, heroes, stats, music] = await Promise.all([
      import('./ui/app.js'),
      fetch('content/campaign.json').then((r) => r.json()),
      fetch('content/heroes.json').then((r) => r.json()),
      fetch('content/stats.json').then((r) => (r.ok ? r.json() : { datasets: [] })).catch(() => ({ datasets: [] })),
      fetch('content/music.json').then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]);
    const app = new App(root, { campaign, heroes, stats, music });
    window.__nj = app; // handy for debugging and automated tests
    await app.start();
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="fatal"><h1>NIGHTJARS</h1><p>Could not start: ${String(err && err.message || err)}</p></div>`;
  }
}

boot();
