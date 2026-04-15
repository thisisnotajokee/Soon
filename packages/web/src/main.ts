import { createApiClient } from './api-client.mjs';

export async function bootstrapSoonWeb(baseUrl = 'http://127.0.0.1:3100') {
  const client = createApiClient(baseUrl);
  const health = await client.health();
  const trackingList = await client.listTrackings();

  return {
    health,
    trackingCount: trackingList.count,
  };
}

if (typeof window !== 'undefined') {
  bootstrapSoonWeb(window.location.origin).catch((error) => {
    console.error('[Soon/web] bootstrap failed', error);
  });
}
