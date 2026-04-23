export interface TelemetryEvent {
  name: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

const BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 30000;

let queue: TelemetryEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  if (!queue.length) return;
  const batch = queue.slice(0, BATCH_SIZE);
  queue = queue.slice(BATCH_SIZE);

  if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
    navigator.sendBeacon('/api/telemetry', JSON.stringify({ events: batch }));
  } else {
    fetch('/api/telemetry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
    }).catch(() => {});
  }

  if (queue.length) {
    flushTimer = setTimeout(flush, 100);
  } else {
    flushTimer = null;
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
}

export function log(eventName: string, metadata?: Record<string, unknown>): void {
  try {
    queue.push({ name: eventName, timestamp: Date.now(), metadata });
    if (queue.length >= BATCH_SIZE) {
      if (flushTimer) clearTimeout(flushTimer);
      flush();
    } else {
      scheduleFlush();
    }
  } catch {
    // telemetry should never throw
  }
}

export function flushNow(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flush();
}
