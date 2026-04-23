import { state, I18N } from '../state/index.js';
import type { Lang } from '../state/types.js';

type TranslationSet = (typeof I18N)[Lang];

export function t(): TranslationSet {
  return I18N[state.lang] as TranslationSet;
}

export function setQueryParam(key: string, value: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set(key, value);
  window.history.replaceState({}, '', url.toString());
}
