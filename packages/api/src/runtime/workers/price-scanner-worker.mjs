export async function runPriceScannerWorker({ store }) {
  const startedAt = new Date().toISOString();
  const trackings = await store.listTrackings();
  const scanned = trackings.length;

  return {
    worker: 'price-scanner',
    status: 'ok',
    scanned,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}
