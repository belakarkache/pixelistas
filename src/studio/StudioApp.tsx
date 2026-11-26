import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { HomePage } from './HomePage';
import { useTheme } from './useTheme';
import { ToastHost } from './toast';
import { TooltipHost } from './Tooltip';
import { useT } from './i18n';
import './studio.css';

const EditorRoute = lazy(() => import('./Editor').then((m) => ({ default: m.EditorRoute })));

export function StudioApp() {
  const t = useT();
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  return (
    <div className="studio">
      <Suspense fallback={<div className="studio-loading">{t('Opening…')}</div>}>
        <Routes>
          <Route path="/" element={<HomePage dark={dark} onToggleTheme={toggle} />} />
          <Route path="/edit/:id" element={<EditorRoute dark={dark} onToggleTheme={toggle} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <ToastHost />
      <TooltipHost />
    </div>
  );
}
