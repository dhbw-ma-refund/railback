import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../lib/LanguageContext';
import './BurgerMenu.css';

// Simple Icon component
const Icon = ({
  name,
  size = 21,
  color = 'currentColor',
  className,
}: {
  name: string;
  size?: number;
  color?: string;
  className?: string;
}) => {
  const icons: Record<string, JSX.Element> = {
    close: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="6" y1="6" x2="18" y2="18" />
        <line x1="18" y1="6" x2="6" y2="18" />
      </svg>
    ),
    login: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
        <polyline points="10 17 15 12 10 7" />
        <line x1="15" y1="12" x2="3" y2="12" />
      </svg>
    ),
    logout: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
    ),
    user: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M5 21a7 7 0 0 1 14 0" />
      </svg>
    ),
    info: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="11" x2="12" y2="16" />
        <line x1="12" y1="8" x2="12" y2="8.01" />
      </svg>
    ),
    support: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4" />
        <line x1="12" y1="17" x2="12" y2="17.01" />
      </svg>
    ),
    globe: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18" />
      </svg>
    ),
    legal: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v18" />
        <path d="M5 7h14" />
        <path d="M8 7l-3 6a3 3 0 0 0 6 0z" />
        <path d="M16 7l3 6a3 3 0 0 1-6 0z" />
      </svg>
    ),
    chevronRight: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 6 15 12 9 18" />
      </svg>
    ),
    chevronDown: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    ),
  };

  const icon = icons[name];
  return icon ? <span className={className}>{icon}</span> : null;
};

interface BurgerMenuProps {
  open: boolean;
  onClose: () => void;
}

export const BurgerMenu = ({ open, onClose }: BurgerMenuProps) => {
  const navigate = useNavigate();
  const { lang, setLang, t } = useLanguage();
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggleAuth = () => {
    setLoggedIn(!loggedIn);
  };

  const goTo = (path: string) => {
    onClose();
    navigate(path);
  };

  return (
    <>
      <div className={'scrim' + (open ? ' open' : '')} onClick={onClose}></div>
      <nav className={'menu' + (open ? ' open' : '')} aria-hidden={!open}>
        <div className="menu__head">
          <button className="menu__auth" onClick={toggleAuth}>
            <Icon name={loggedIn ? 'logout' : 'login'} size={21} />
            {loggedIn ? t.menu.logout : t.menu.login}
          </button>
          <button className="menu__close" onClick={onClose} aria-label="Zurück">
            <Icon name="close" size={18} color="#fff" />
          </button>
        </div>
        <div className="menu__list">
          <button className="menu__item" onClick={() => goTo('/user')}>
            <Icon name="user" size={21} className="ic" />
            <span>{t.menu.account}</span>
            <Icon name="chevronRight" size={18} className="menu__arrow" color="var(--color-muted-gray-blue)" />
          </button>
          <button className="menu__item" onClick={() => goTo('/faq')}>
            <Icon name="info" size={21} className="ic" />
            <span>{t.menu.faq}</span>
            <Icon name="chevronRight" size={18} className="menu__arrow" color="var(--color-muted-gray-blue)" />
          </button>
          <a className="menu__item" href="mailto:support@railback.de?subject=Support-Anfrage%20RailBack">
            <Icon name="support" size={21} className="ic" />
            <span>{t.menu.support}</span>
            <Icon name="chevronRight" size={18} className="menu__arrow" color="var(--color-muted-gray-blue)" />
          </a>
          <div className="lang-row">
            <button
              className={`lang-chip${lang === 'de' ? ' on' : ''}`}
              onClick={() => setLang('de')}
            >
              DE
            </button>
            <button
              className={`lang-chip${lang === 'en' ? ' on' : ''}`}
              onClick={() => setLang('en')}
            >
              EN
            </button>
          </div>
          <div className="menu__divider"></div>
          <button className="menu__item" onClick={() => goTo('/rechtliches')}>
            <Icon name="legal" size={21} className="ic" />
            <span>{t.menu.legal}</span>
            <Icon name="chevronRight" size={18} className="menu__arrow" color="var(--color-muted-gray-blue)" />
          </button>
          <button className="menu__item" onClick={() => goTo('/impressum')}>
            <Icon name="info" size={21} className="ic" />
            <span>{t.menu.imprint}</span>
            <Icon name="chevronRight" size={18} className="menu__arrow" color="var(--color-muted-gray-blue)" />
          </button>
        </div>
      </nav>
    </>
  );
};
