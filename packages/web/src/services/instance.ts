import { createApiClient } from './client.js';

export const client = createApiClient(window.location.origin);
