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
              <span className="footer__logo">RailBack</span>
            </div>
            <p className="footer__tagline">{t.footer.tagline}</p>
          </div>
          <div className="footer__links">
            <a href="/faq">{t.menu.faq}</a>
            <a href="/impressum">{t.menu.imprint}</a>
            <a href="/rechtliches">{t.menu.legal}</a>
          </div>
          <div className="footer__copy">
            {t.footer.copyright}
          </div>
        </div>
      </div>
    </footer>
  );
};
