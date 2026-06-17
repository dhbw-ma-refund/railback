/* ============================================================
   RailBack — App (Routing, Login-State, Sprache)
   ============================================================ */
const { useState: useStateA, useEffect: useEffectA, useRef: useRefA } = React;
const ROUTES = ["landing", "faq", "faq-detail", "impressum", "rechtliches"];
const FAQ_TOPIC_IDS = ["ticket", "reise", "anspruch", "antrag"];

function getInitialView() {
  const savedRoute = localStorage.getItem("rb_route");
  const savedTopic = localStorage.getItem("rb_topic");
  const route = ROUTES.includes(savedRoute) ? savedRoute : "landing";

  if (route === "faq-detail") {
    return FAQ_TOPIC_IDS.includes(savedTopic)
      ? { route, topic: savedTopic }
      : { route: "faq", topic: null };
  }

  return { route, topic: null };
}

function App() {
  const initialView = getInitialView();
  const [lang, setLangRaw] = useStateA(() => localStorage.getItem("rb_lang") || "de");
  const [route, setRoute] = useStateA(initialView.route);      // landing | faq | faq-detail | impressum | rechtliches
  const [topic, setTopic] = useStateA(initialView.topic);
  const [menuOpen, setMenuOpen] = useStateA(false);
  const [loggedIn, setLoggedIn] = useStateA(false);
  const [toast, setToast] = useStateA(null);
  const toastTimer = useRefA(null);
  const mainRef = useRefA(null);

  const t = I18N[lang];

  const setLang = (l) => { setLangRaw(l); localStorage.setItem("rb_lang", l); };

  useEffectA(() => { document.documentElement.lang = lang; }, [lang]);
  useEffectA(() => {
    localStorage.setItem("rb_route", route);
    if (route === "faq-detail" && topic) {
      localStorage.setItem("rb_topic", topic);
    } else {
      localStorage.removeItem("rb_topic");
    }
  }, [route, topic]);

  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  };

  const scrollTop = () => { if (mainRef.current) mainRef.current.scrollTop = 0; window.scrollTo(0, 0); };

  const go = (r) => {
    setMenuOpen(false);
    if (r === "support") {
      const subject = encodeURIComponent("Support-Anfrage RailBack");
      window.location.href = `mailto:support@railback.de?subject=${subject}`;
      return;
    }
    if (r === "konto") { showToast(t.toast.soon); return; }
    setRoute(r);
    setTopic(null);
    scrollTop();
  };

  const openTopic = (id) => { setTopic(id); setRoute("faq-detail"); scrollTop(); };

  const toggleAuth = () => {
    setLoggedIn(v => {
      const nv = !v;
      showToast(nv ? t.toast.login : t.toast.logout);
      return nv;
    });
    setMenuOpen(false);
  };

  const onCheckClaim = () => showToast(t.toast.soon);
  const headerBackRoutes = ["faq", "faq-detail", "impressum", "rechtliches"];
  const headerBack = () => go(route === "faq-detail" ? "faq" : "landing");

  return (
    <div className={"app app--" + route}>
      <Header
        onHome={() => go("landing")}
        onBurger={() => setMenuOpen(v => !v)}
        menuOpen={menuOpen}
        showBack={headerBackRoutes.includes(route)}
        onBack={headerBack}
        backLabel={t.menu.back}
      />
      <BurgerMenu
        open={menuOpen} onClose={() => setMenuOpen(false)}
        t={t} lang={lang} setLang={setLang}
        loggedIn={loggedIn} toggleAuth={toggleAuth} go={go} route={route}
      />

      <main className="main" ref={mainRef}>
        {route === "landing" && <Landing t={t} go={go} onCheckClaim={onCheckClaim} />}
        {route === "faq" && <FAQOverview t={t} openTopic={openTopic} />}
        {route === "faq-detail" && topic && <FAQDetail t={t} lang={lang} topicId={topic} back={() => go("faq")} />}
        {route === "impressum" && <LegalPage t={t} back={() => go("landing")}><ImpressumBody lang={lang} /></LegalPage>}
        {route === "rechtliches" && <LegalPage t={t} back={() => go("landing")}><RechtlichesBody lang={lang} /></LegalPage>}
      </main>

      <Footer t={t} go={go} />

      <div className={"toast" + (toast ? " show" : "")}>
        <Icon name="info" size={18} color="#fff" /> {toast}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
