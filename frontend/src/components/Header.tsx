import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Header.css';
import { BurgerMenu } from './BurgerMenu';
import { useLanguage } from '../lib/LanguageContext';
import railbackLogo from '../../shared/assets/railback-logo.png';

interface HeaderProps {
  /**
   * Overrides the CTA label in the nav button and the primary burger-menu item.
   * Used by campaign landing pages so the whole page shares one CTA wording.
   * Falls back to the default hero CTA when omitted.
   */
  ctaLabel?: string;
}

export const Header = ({ ctaLabel }: HeaderProps) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { t } = useLanguage();

  const cta = ctaLabel ?? t.hero.cta1;

  const toggleMenu = () => {
    setMenuOpen(!menuOpen);
  };

  const closeMenu = () => {
    setMenuOpen(false);
  };

  return (
    <>
      <header className="hdr">
        <div className="hdr__left">
          <button className="brand" onClick={() => navigate('/')}>
            <img
              src={railbackLogo}
              alt="RailBack Logo"
              className="brand__logo"
            />
            <span className="brand__text">
              <span className="brand__name">RailBack</span>
              <span className="brand__claim">{t.hero.claim}</span>
            </span>
          </button>
        </div>
        <nav className="hdr__nav" aria-label="Hauptnavigation">
          <button className="hdr__link" onClick={() => navigate('/preise')}>
            {t.menu.prices}
          </button>
          <button className="hdr__cta" onClick={() => navigate('/user')}>
            {cta}
          </button>
        </nav>
        <button
          className="burger"
          aria-label="Menü"
          aria-expanded={menuOpen}
          onClick={toggleMenu}
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
      </header>
      <BurgerMenu open={menuOpen} onClose={closeMenu} ctaLabel={ctaLabel} />
    </>
  );
};
