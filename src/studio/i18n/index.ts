import { useSyncExternalStore } from 'react';
import { readPref, writePref } from '../prefs';
import { ptBR } from './pt-BR';

type Locale = 'en' | 'pt-BR';

export const LOCALES: { id: Locale; short: string; name: string }[] = [
  { id: 'en', short: 'EN', name: 'English' },
  { id: 'pt-BR', short: 'PT', name: 'Português (Brasil)' },
];

const KEY = 'pixelistas-lang';
const dictionaries: Record<Locale, Record<string, string> | null> = { en: null, 'pt-BR': ptBR };
const listeners = new Set<() => void>();

const initial = (): Locale => (readPref(KEY) === 'pt-BR' ? 'pt-BR' : 'en');

const META: Record<Locale, { title: string; description: string }> = {
  en: { title: 'Pixelistas — Make something tiny', description: 'Pixelistas — a calm, modern pixel art studio in the browser.' },
  'pt-BR': { title: 'Pixelistas — Crie algo pequenininho', description: 'Pixelistas — um estúdio de pixel art calmo e moderno, direto no navegador.' },
};

let current: Locale = initial();

function applyDocument(locale: Locale) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.title = META[locale].title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', META[locale].description);
}

applyDocument(current);

export const getLocale = () => current;

export function setLocale(next: Locale) {
  if (next === current) return;
  current = next;
  writePref(KEY, next);
  applyDocument(next);
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

type Params = Record<string, string | number>;

export function t(text: string, params?: Params): string {
  const base = dictionaries[current]?.[text] ?? text;
  return params ? base.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : base;
}

export const msg = (text: string) => text;

export function useI18n() {
  const locale = useSyncExternalStore(subscribe, getLocale);
  return { locale, t, setLocale };
}

export const useT = () => useI18n().t;
