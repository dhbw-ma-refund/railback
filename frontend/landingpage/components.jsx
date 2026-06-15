/* ============================================================
   RailBack — Icons (Outline, 2px, rounded) & shared components
   ============================================================ */
const { useState, useEffect, useRef } = React;

/* ---------- Icon set (24x24 grid, stroke 2, rounded) ---------- */
function Icon({ name, size = 24, color = "currentColor", stroke = 2, style }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: color, strokeWidth: stroke, strokeLinecap: "round", strokeLinejoin: "round", style };
  const paths = {
    menu: <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>,
    close: <><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></>,
    chevronRight: <polyline points="9 6 15 12 9 18"/>,
    chevronDown: <polyline points="6 9 12 15 18 9"/>,
    arrowLeft: <><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/></>,
    login: <><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></>,
    logout: <><path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
    support: <><circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4"/><line x1="12" y1="17" x2="12" y2="17.01"/></>,
    globe: <><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18"/></>,
    legal: <><path d="M12 3v18"/><path d="M5 7h14"/><path d="M8 7l-3 6a3 3 0 0 0 6 0z"/><path d="M16 7l3 6a3 3 0 0 1-6 0z"/></>,
    info: <><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12" y2="8.01"/></>,
    ticket: <><path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M8 9h5"/><path d="M8 12h3"/><polyline points="13.5 13.2 15.4 15 18.4 11.5"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></>,
    euro: <><path d="M4 10h12"/><path d="M4 14h9"/><path d="M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2"/></>,
    check: <polyline points="4 12 10 18 20 6"/>,
    checkCircle: <><circle cx="12" cy="12" r="9"/><polyline points="8 12 11 15 16 9"/></>,
    shield: <><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><polyline points="9 12 11 14 15 10"/></>,
    bolt: <polygon points="13 2 4 14 11 14 10 22 20 10 13 10 13 2"/>,
    upload: <><path d="M5 19V7a2 2 0 0 1 2-2h6l6 6v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M13 5v5a1 1 0 0 0 1 1h5"/><path d="M10 15h4"/><polyline points="12 17 14 15 12 13"/></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5L4 20"/></>,
  };
  return <svg {...p}>{paths[name] || null}</svg>;
}

const LOGO = "../shared/assets/railback-logo.png";

/* ---------- Brand lockup ---------- */
function Brand({ onClick, name = true }) {
  return (
    <button className="brand" onClick={onClick} aria-label="RailBack — Startseite">
      <img className="brand__logo" src={LOGO} alt="RailBack Logo" />
      {name && <span className="brand__name">RailBack</span>}
    </button>
  );
}

/* ---------- Header ---------- */
function Header({ onHome, onBurger, menuOpen, showBack = false, onBack, backLabel = "Zurück" }) {
  return (
    <header className="hdr">
      <div className="hdr__left">
        <Brand onClick={onHome} />
        {showBack && (
          <button className="hdr__back rb-button rb-button--secondary rb-button--medium" onClick={onBack}>
            <Icon name="arrowLeft" size={18} /> {backLabel}
          </button>
        )}
      </div>
      <button className="burger" aria-expanded={menuOpen} aria-label="Menü" onClick={onBurger}>
        <span></span><span></span><span></span>
      </button>
    </header>
  );
}

/* ---------- Burger Menu ---------- */
function BurgerMenu({ open, onClose, t, lang, setLang, loggedIn, toggleAuth, go, route }) {
  const [langOpen, setLangOpen] = useState(false);
  useEffect(() => { if (!open) setLangOpen(false); }, [open]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const itemContent = (icon, label, opts = {}) => (
    <>
      <Icon name={icon} size={21} className="ic" />
      <span>{label}</span>
      {opts.chev !== false && <Icon name={opts.chev || "chevronRight"} size={18} stroke={2.2} color="var(--color-muted-gray-blue)" style={{ marginLeft: "auto" }} />}
    </>
  );

  const item = (icon, label, onClick, opts = {}) => {
    const className = "menu__item" + (opts.active ? " active" : "");

    if (opts.href) {
      return (
        <a className={className} href={opts.href} onClick={onClose}>
          {itemContent(icon, label, opts)}
        </a>
      );
    }

    return (
      <button className={className} onClick={onClick}>
        {itemContent(icon, label, opts)}
      </button>
    );
  };

  return (
    <>
      <div className={"scrim" + (open ? " open" : "")} onClick={onClose}></div>
      <nav className={"menu" + (open ? " open" : "")} aria-hidden={!open}>
        <div className="menu__head">
          <button className="menu__auth" onClick={toggleAuth}>
            <Icon name={loggedIn ? "logout" : "login"} size={21} />
            {loggedIn ? t.auth.signout : t.auth.signin}
          </button>
          <button className="menu__close" onClick={onClose} aria-label={t.menu.back}>
            <Icon name="close" size={18} color="#fff" />
          </button>
        </div>
        <div className="menu__list">
          {item("user", t.nav.konto, () => go("konto"))}
          {item("support", t.nav.support, null, { href: "mailto:support@railback.de?subject=Support-Anfrage%20RailBack" })}
          {item("globe", t.nav.sprache, () => setLangOpen(v => !v), { chev: langOpen ? "chevronDown" : "chevronRight" })}
          {langOpen && (
            <div className="lang-row">
              <button className={"lang-chip" + (lang === "de" ? " on" : "")} onClick={() => setLang("de")}>Deutsch</button>
              <button className={"lang-chip" + (lang === "en" ? " on" : "")} onClick={() => setLang("en")}>English</button>
            </div>
          )}
          <div className="menu__divider"></div>
          {item("legal", t.nav.rechtliches, () => go("rechtliches"), { active: route === "rechtliches" })}
          {item("info", t.nav.impressum, () => go("impressum"), { active: route === "impressum" })}
        </div>
      </nav>
    </>
  );
}

/* ---------- Image placeholder ---------- */
function ImgPlaceholder({ label }) {
  return (
    <div className="imgph">
      <Icon name="image" size={30} color="rgba(9,67,137,0.4)" />
      <span className="label">{label}</span>
    </div>
  );
}

/* ---------- Phone Mockup ---------- */
function PhoneMockup({ p }) {
  return (
    <div className="phone-col">
      <div className="phone">
        <div className="phone__notch"></div>
        <div className="phone__screen">
          <div className="phone__status">
            <span>{p.time}</span>
            <span className="sig"><Icon name="bolt" size={13} color="var(--color-text-primary)" /> 100%</span>
          </div>
          <div className="phone__body">
            <div className="phone__hi">{p.hi}</div>
            <p>{p.sub}</p>

            <div className="tripcard">
              <div className="tripcard__route">
                {p.route[0]} <Icon name="chevronRight" size={16} color="#fff" /> {p.route[1]}
              </div>
              <div className="tripcard__meta">{p.meta}</div>
              <div className="tripcard__amt">{p.amt}</div>
              <div className="tripcard__amtlabel">{p.amtLabel}</div>
              <span className="chip-delay"><Icon name="clock" size={14} className="ic" /> {p.delay}</span>
            </div>

            <div className="minicard">
              <div className="badge-ic"><Icon name="checkCircle" size={20} /></div>
              <div>
                <div className="t">{p.miniT}</div>
                <div className="s">{p.miniS}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="float-badge">
        <div className="float-badge__top">
          <span className="pct">{p.badgePct}</span> {p.badgeT}
        </div>
        <div className="float-badge__sub">{p.badgeSub}</div>
      </div>
    </div>
  );
}

/* ---------- Footer ---------- */
function Footer({ t, go }) {
  return (
    <footer className="foot">
      <div className="foot__in">
        <div className="foot__brand">
          <img src={LOGO} alt="" /> RailBack
        </div>
        <span className="caption" style={{ fontStyle: "italic" }}>{t.footer.tagline}</span>
        <div className="foot__links">
          <button onClick={() => go("faq")}>{t.nav.faq}</button>
          <button onClick={() => go("rechtliches")}>{t.nav.rechtliches}</button>
          <button onClick={() => go("impressum")}>{t.nav.impressum}</button>
        </div>
        <div className="foot__copy">{t.footer.rights}</div>
      </div>
    </footer>
  );
}

Object.assign(window, { Icon, Brand, Header, BurgerMenu, ImgPlaceholder, PhoneMockup, Footer, LOGO });
