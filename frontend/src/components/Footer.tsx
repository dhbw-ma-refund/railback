import { Link } from 'react-router-dom';
import { useLanguage } from '../lib/LanguageContext';
import './Footer.css';
import railbackLogo from '../../shared/assets/railback-logo.png';

export const Footer = () => {
  const { t } = useLanguage();

  return (
    <footer className="footer">
      <div className="wrap container">
        <div className="footer__content">
          <div className="footer__brand">
            <div className="footer__logo-wrapper">
              <img
                src={railbackLogo}
                alt="RailBack Logo"
                className="footer__logo-img"
              />
              <span className="footer__logo-text">
                <span className="footer__logo">RailBack</span>
                <span className="footer__logo-claim">{t.hero.claim}</span>
              </span>
            </div>
          </div>
          <div className="footer__links">
            <Link to="/faq">{t.menu.faq}</Link>
            <Link to="/#preise">{t.menu.prices}</Link>
            <Link to="/impressum">{t.menu.imprint}</Link>
            <Link to="/rechtliches">{t.menu.legal}</Link>
          </div>
          <div className="footer__copy">
            {t.footer.copyright}
          </div>
        </div>
      </div>
    </footer>
  );
};
