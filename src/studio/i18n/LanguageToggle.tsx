import { LOCALES, useI18n } from './index';

export function LanguageToggle({ className }: { className?: string }) {
  const { locale, setLocale } = useI18n();
  return (
    <div className={`lang-toggle ${className ?? ''}`} role="group" aria-label="Language / Idioma">
      {LOCALES.map((l) => (
        <button key={l.id} type="button" className={locale === l.id ? 'active' : ''} lang={l.id} title={l.name} aria-pressed={locale === l.id} onClick={() => setLocale(l.id)}>
          {l.short}
        </button>
      ))}
    </div>
  );
}
