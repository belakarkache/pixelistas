import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Icon } from './Icon';
import { HeroArt } from './HeroArt';
import { CreateDialog } from './dialogs';
import { ConfirmDialog, PromptDialog } from './Modal';
import { useContextMenu } from './ContextMenu';
import { deleteProject, duplicateProject, listProjects, renameProject, saveProject } from './storage';
import { docFromImage } from './importer';
import { newDoc, newProject, type ProjectSummary } from './model';
import { toast } from './toast';
import { LanguageToggle } from './i18n/LanguageToggle';
import { getLocale, t, useT } from './i18n';

const relativeDate = (time: number) => {
  const mins = Math.floor((Date.now() - time) / 60000);
  if (mins < 1) return t('Just now');
  if (mins < 60) return t('{n} min ago', { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('{n} h ago', { n: hours });
  const days = Math.floor(hours / 24);
  if (days === 1) return t('Yesterday');
  if (days < 7) return t('{n} days ago', { n: days });
  return new Date(time).toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' });
};

type DialogState = { kind: 'create' } | { kind: 'rename'; project: ProjectSummary } | { kind: 'delete'; project: ProjectSummary } | null;

export function HomePage({ dark, onToggleTheme }: { dark: boolean; onToggleTheme: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const menu = useContextMenu();
  const latest = projects?.[0] ?? null;

  const refresh = () =>
    listProjects()
      .then(setProjects)
      .catch(() => setFailed(true));

  useEffect(() => {
    refresh();
  }, []);

  const create = async (name: string, w: number, h: number, background: string | null) => {
    const project = newProject(name, newDoc(w, h, background ?? undefined));
    try {
      await saveProject(project);
      navigate(`/edit/${project.id}`);
    } catch {
      toast(t('Could not create the project. Is storage blocked?'));
    }
  };

  const duplicate = async (p: ProjectSummary) => {
    try {
      await duplicateProject(p.id);
      refresh();
      toast(t('Project duplicated'));
    } catch {
      toast(t('Could not duplicate the project'));
    }
  };

  const openImage = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast(t('That file is not an image'));
      return;
    }
    try {
      const { doc, downscaled } = await docFromImage(file);
      const project = newProject(file.name.replace(/\.[^.]+$/, ''), doc);
      await saveProject(project);
      if (downscaled) toast(t('Image was scaled down to {w} × {h}', { w: doc.width, h: doc.height }));
      navigate(`/edit/${project.id}`);
    } catch {
      toast(t('Could not open that image'));
    }
  };

  return (
    <div
      className={`home ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) openImage(file);
      }}
    >
      <LanguageToggle className="home-lang-toggle" />
      <button className="icon-button home-theme-toggle" onClick={onToggleTheme} title={dark ? t('Light mode') : t('Dark mode')} aria-label={t('Toggle theme')}>
        <Icon name={dark ? 'sun' : 'moon'} />
      </button>
      <main className="home-content">
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow">{t('100% free pixel art studio')}</div>
            <h1>
              {t('Make something')} <span>{t('tiny.')}</span>
            </h1>
            <p>{t('Draw sprites, animate them frame by frame and export to PNG, GIF or spritesheet')}</p>
            <div className="hero-actions">
              <button className="primary-button large" onClick={() => setDialog({ kind: 'create' })}>
                <Icon name="plus" size={16} /> {t('New artwork')}
              </button>
              <button className="ghost-button large" onClick={() => fileInput.current?.click()}>
                <Icon name="upload" size={16} /> {t('Open image')}
              </button>
            </div>
            {latest ? (
              <Link to={`/edit/${latest.id}`} className="hero-continue">
                <img src={latest.thumb} alt="" />
                <span>
                  <small>{t('Continue where you left off')}</small>
                  <strong>{latest.name}</strong>
                </span>
                <Icon name="next" size={16} />
              </Link>
            ) : (
              <ul className="hero-points">
                <li>
                  <Icon name="check" size={14} /> {t('Free, no sign-up')}
                </li>
                <li>
                  <Icon name="check" size={14} /> {t('Mouse, pen or touch')}
                </li>
                <li>
                  <Icon name="check" size={14} /> {t('Drop any image to start')}
                </li>
              </ul>
            )}
          </div>
          <HeroArt />
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) openImage(file);
              e.currentTarget.value = '';
            }}
          />
        </section>

        <section className="recent-section">
          <div className="section-title-row">
            <h2>{t('Your projects')}</h2>
            {projects && projects.length > 0 && <span>{projects.length === 1 ? t('1 project') : t('{n} projects', { n: projects.length })}</span>}
          </div>
          {failed ? (
            <div className="empty-projects">
              <h3>{t('Storage is not available')}</h3>
              <p>{t('This browser is blocking local storage (private mode?). You can still draw, but projects may not be kept.')}</p>
            </div>
          ) : projects === null ? (
            <div className="project-grid">
              {[0, 1, 2].map((i) => (
                <div key={i} className="project-card skeleton" />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="empty-projects">
              <div className="empty-art">
                <span className="pixel-sun" />
                <span className="pixel-mountain" />
                <span className="pixel-ground" />
              </div>
              <div>
                <h3>{t('Your canvas is waiting')}</h3>
                <p>{t('Create your first piece, or drop an image here to start from it.')}</p>
                <button className="primary-button" onClick={() => setDialog({ kind: 'create' })}>
                  <Icon name="plus" size={15} /> {t('Start drawing')}
                </button>
              </div>
            </div>
          ) : (
            <div className="project-grid">
              {projects.map((p) => (
                <article
                  className="project-card"
                  key={p.id}
                  onContextMenu={(e) =>
                    menu.open(e, [
                      { label: t('Open'), icon: 'next', onSelect: () => navigate(`/edit/${p.id}`) },
                      { label: t('Rename'), icon: 'edit', onSelect: () => setDialog({ kind: 'rename', project: p }) },
                      { label: t('Duplicate'), icon: 'copy', onSelect: () => duplicate(p) },
                      { separator: true },
                      { label: t('Delete'), icon: 'trash', danger: true, onSelect: () => setDialog({ kind: 'delete', project: p }) },
                    ])
                  }
                >
                  <Link to={`/edit/${p.id}`} className="project-open">
                    <div className="art-preview">
                      <img src={p.thumb} alt="" style={{ aspectRatio: `${p.width}/${p.height}` }} />
                    </div>
                    <div className="project-info">
                      <h3 title={p.name}>{p.name}</h3>
                      <span>
                        {p.width}×{p.height}
                        {p.frameCount > 1 && ` · ${t('{n} frames', { n: p.frameCount })}`} · {relativeDate(p.updatedAt)}
                      </span>
                    </div>
                  </Link>
                  <div className="project-actions">
                    <button className="icon-button small" title={t('Rename')} aria-label={t('Rename {name}', { name: p.name })} onClick={() => setDialog({ kind: 'rename', project: p })}>
                      <Icon name="edit" size={14} />
                    </button>
                    <button
                      className="icon-button small"
                      title={t('Duplicate')}
                      aria-label={t('Duplicate {name}', { name: p.name })}
                      onClick={() => duplicate(p)}
                    >
                      <Icon name="copy" size={14} />
                    </button>
                    <button className="icon-button small danger" title={t('Delete')} aria-label={t('Delete {name}', { name: p.name })} onClick={() => setDialog({ kind: 'delete', project: p })}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        <p className="home-footer-note">{t('Projects are saved privately in this browser. Export your art to keep a copy elsewhere.')}</p>
        <p className="home-footer-note home-credit">
          {t('developed by')} <a href="https://icka.dev" target="_blank" rel="noopener noreferrer">icka.dev</a>
        </p>
      </main>
      {menu.element}
      {dragging && <div className="drop-overlay">{t('Drop the image to open it as a new artwork')}</div>}

      {dialog?.kind === 'create' && <CreateDialog onCreate={create} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'rename' && (
        <PromptDialog
          title={t('Rename project')}
          label={t('Name')}
          initial={dialog.project.name}
          confirm={t('Rename')}
          onConfirm={async (name) => {
            await renameProject(dialog.project.id, name);
            refresh();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={t('Delete project?')}
          message={t('“{name}” will be removed from this browser. This can’t be undone.', { name: dialog.project.name })}
          confirm={t('Delete')}
          danger
          onConfirm={async () => {
            await deleteProject(dialog.project.id);
            refresh();
            toast(t('Project deleted'));
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
