/* ============================================================
   RailBack — Screens
   ============================================================ */
const { useState: useStateS } = React;

/* ---------- Landing ---------- */
function Landing({ t, go, onCheckClaim }) {
  return (
    <section className="hero">
      <div className="hero__bg"></div>
      <div className="wrap">
        <div className="hero__grid">
          <div className="hero__copy fade-in">
            <div className="hero__mobilelogo">
              <img src={LOGO} alt="RailBack Logo" />
              <span className="nm">RailBack</span>
            </div>
            <span className="hero__claim"><span className="dot"></span>{t.hero.claim}</span>
            <h1 className="h1">{t.hero.title}</h1>
            <p className="hero__sub">{t.hero.sub}</p>
            <div className="hero__cta">
              <button className="btn btn--primary" onClick={onCheckClaim}>
                <Icon name="upload" size={20} color="#fff" /> {t.hero.cta1}
              </button>
              <button className="btn btn--secondary" onClick={() => go("faq")}>{t.hero.cta2}</button>
            </div>
            <div className="hero__tag">
              {t.hero.tag.map((w, i) => <b key={i} style={{ color: i === 1 ? "var(--green-ink)" : "var(--blue)" }}>{w} </b>)}
            </div>
            <div className="trust">
              {t.hero.trust.map((tr, i) => (
                <span className="trust__item" key={i}>
                  <Icon name={["shield", "bolt", "check"][i]} size={18} className="ic" /> {tr}
                </span>
              ))}
            </div>
          </div>
          <PhoneMockup p={t.phone} />
        </div>
      </div>
    </section>
  );
}

/* ---------- FAQ overview ---------- */
function FAQOverview({ t, openTopic }) {
  const icons = { ticket: "ticket", reise: "clock", anspruch: "euro", antrag: "checkCircle" };
  return (
    <div className="wrap page fade-in">
      <h1 className="h1 title">{t.faq.title}</h1>
      <p className="page__lead">{t.faq.lead}</p>
      <div className="faq-grid">
        {t.faq.topics.map((tp) => (
          <button className="faq-tile" key={tp.id} onClick={() => openTopic(tp.id)}>
            <span className="faq-tile__ic"><Icon name={icons[tp.id]} size={24} /></span>
            <span>
              <span className="faq-tile__t">{tp.t}</span>
              <span className="faq-tile__d" style={{ display: "block" }}>{tp.d}</span>
            </span>
            <Icon name="chevronRight" size={20} className="faq-tile__arrow" color="var(--graublau)" />
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- FAQ detail ---------- */
function FAQDetail({ t, lang, topicId, back }) {
  const meta = t.faq.topics.find(x => x.id === topicId);
  const content = FAQ_CONTENT[lang][topicId];
  const [open, setOpen] = useStateS(0);

  return (
    <div className="wrap page fade-in">
      <div className="page__head">
        <button className="back" onClick={back}>
          <Icon name="arrowLeft" size={18} /> {t.faq.title}
        </button>
      </div>
      <h1 className="h1 title">{meta.t}</h1>
      <p className="page__lead">{meta.d}</p>

      <div style={{ maxWidth: 760 }}>
        <ImgPlaceholder label={content.img} />
        <div className="qa-wrap">
          {content.qa.map((item, i) => (
            <div className={"qa" + (open === i ? " open" : "")} key={i}>
              <button className="qa__q" onClick={() => setOpen(open === i ? -1 : i)}>
                <span className="num">{i + 1}</span>
                <span>{item.q}</span>
                <Icon name="chevronDown" size={18} className="chev" />
              </button>
              <div className="qa__a">
                <div className="qa__a-inner">
                  {item.a.map((para, j) => <p key={j}>{para}</p>)}
                </div>
              </div>
            </div>
          ))}
        </div>
        {content.img2 && <div style={{ marginTop: 16 }}><ImgPlaceholder label={content.img2} /></div>}
      </div>
    </div>
  );
}

/* ---------- Legal wrapper ---------- */
function LegalPage({ t, back, children }) {
  return (
    <div className="wrap page fade-in">
      <div className="page__head">
        <button className="back" onClick={back}>
          <Icon name="arrowLeft" size={18} /> {t.menu.back}
        </button>
      </div>
      {children}
    </div>
  );
}

Object.assign(window, { Landing, FAQOverview, FAQDetail, LegalPage });
