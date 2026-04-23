const DEFAULT_FLAGS = {
    'detail-experimental': false,
    'deals-v2': false,
    'ws-push': false,
    'advanced-add': true,
    'telemetry': true,
    'sw-cache': true,
};
let overrides = {};
try {
    const stored = window.localStorage.getItem('soon.flags');
    if (stored) {
        overrides = JSON.parse(stored);
    }
}
catch {
    // ignore
}
export function isEnabled(key) {
    return overrides[key] ?? DEFAULT_FLAGS[key];
}
export function setFlag(key, value) {
    overrides[key] = value;
    try {
        window.localStorage.setItem('soon.flags', JSON.stringify(overrides));
    }
    catch {
        // ignore
    }
}
export function getAllFlags() {
    const result = {};
    for (const key of Object.keys(DEFAULT_FLAGS)) {
        result[key] = isEnabled(key);
    }
    return result;
}
