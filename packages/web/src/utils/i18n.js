import { state, I18N } from '../state/index.js';
export function t() {
    return I18N[state.lang];
}
export function setQueryParam(key, value) {
    const url = new URL(window.location.href);
    url.searchParams.set(key, value);
    window.history.replaceState({}, '', url.toString());
}
