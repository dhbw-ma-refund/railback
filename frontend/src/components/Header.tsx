import { useState } from 'react';
import './Header.css';
import { BurgerMenu } from './BurgerMenu';

export const Header = () => {
  const [menuOpen, setMenuOpen] = useState(false);

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
          <button className="brand" onClick={() => window.location.href = '/'}>
            <img
              src="/shared/assets/railback-logo.png"
              alt="RailBack Logo"
              className="brand__logo"
            />
            <span className="brand__name">RailBack</span>
          </button>
        </div>
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
      <BurgerMenu open={menuOpen} onClose={closeMenu} />
    </>
  );
};
