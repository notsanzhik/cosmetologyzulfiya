import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  Check,
  Clock3,
  MapPin,
  Phone,
  X,
  Plus,
  Minus,
  Leaf,
  ShieldCheck,
  Heart,
  CalendarDays,
  Sparkles,
  LockKeyhole,
  LoaderCircle,
  ArrowUpRight,
  ArrowUp,
  Droplets,
  Flower2,
} from "lucide-react";
import {
  catalog,
  settings,
  translations,
  priceLabel,
  totalLabel,
  totalAmount,
  dateLabel,
  localDate,
  maskPhone,
  type Lang,
  type PublicBooking,
  type Snapshot,
} from "./shared";
import { ReviewsSection, AdminReviews } from "./reviews";
import { useLandingMotion } from "./motion";
import { normalizePath, publicPage, publicPages, type PublicPage } from "./routes";
import "./styles.css";
import "./motion.css";
import "./pages.css";

type Runtime = {
  bookingEnabled: boolean;
  notificationsEnabled: boolean;
  whatsappEnabled: boolean;
  turnstileSiteKey: string;
  adminConfigured: boolean;
};
const Language = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: "ru",
  setLang: () => {},
});
function useText() {
  const { lang, setLang } = useContext(Language);
  return { lang, setLang, t: translations[lang] };
}
class ApiError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await response.json()) as T & { code?: string };
  if (!response.ok) throw new ApiError(body.code || "unavailable");
  return body as T;
}
function message(error: unknown, lang: Lang) {
  const code = error instanceof ApiError ? error.code : "unavailable";
  if (code === "busy") return translations[lang].services.busy;
  return (
    translations[lang].errors[code as keyof typeof translations.ru.errors] ||
    translations[lang].errors.unavailable
  );
}
const post = (body: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
});
function LangSwitch() {
  const { lang, setLang } = useText();
  return (
    <div className="languages" aria-label={translations[lang].language}>
      <button aria-pressed={lang === "ru"} onClick={() => setLang("ru")}>
        RU
      </button>
      <span>/</span>
      <button aria-pressed={lang === "kk"} onClick={() => setLang("kk")}>
        ҚАЗ
      </button>
    </div>
  );
}
function Brand() {
  const { t } = useText();
  return (
    <a className="brand" href="/">
      <span>
        {t.brand}
      </span>
      <small>{t.studio}</small>
    </a>
  );
}
function Header({ active }: { active: PublicPage | null }) {
  const { t } = useText();
  const [pointed, setPointed] = useState<string | null>(null);
  const nav = useRef<HTMLElement>(null);
  const [pill, setPill] = useState({ x: 0, y: 0, width: 0, height: 0 });
  useEffect(() => {
    const element = nav.current;
    if (!element) return;
    const measure = () => {
      const link = element.querySelector<HTMLElement>(`[data-nav-key="${pointed || active}"]`);
      if (link) setPill({ x: link.offsetLeft, y: link.offsetTop, width: link.offsetWidth, height: link.offsetHeight });
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    element.querySelectorAll("a").forEach(link => resize.observe(link));
    return () => resize.disconnect();
  }, [pointed, active, t]);
  return (
    <header className="header">
      <div className="container header-inner">
        <Brand />
        <nav ref={nav} id="main-navigation" className="nav" aria-label={t.pages.navigation}
          onMouseLeave={() => setPointed(null)}
          onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPointed(null); }}>
          {/* Одна общая подложка плавно переезжает между ссылками, сохраняя форму. */}
          <span className="nav-highlight" aria-hidden="true" style={{ width: pill.width, height: pill.height,
            transform: `translate(${pill.x}px, ${pill.y}px)`, opacity: pill.width ? 1 : 0 }} />
          {(Object.keys(publicPages) as PublicPage[]).map(key => (
            <a key={key} data-nav-key={key} href={publicPages[key]} aria-current={active === key ? "page" : undefined}
              onMouseEnter={() => setPointed(key)} onFocus={() => setPointed(key)}
              onClick={() => setPointed(null)}>
              {t.nav[key]}
            </a>
          ))}
        </nav>
        <div className="header-controls">
          <LangSwitch />
          <a className="button small header-book" href="/procedures">
            {t.services.submit}
            <span className="header-book-arrow"><ArrowUpRight size={19} aria-hidden="true" /></span>
          </a>
        </div>
      </div>
      <div className="scroll-progress" aria-hidden="true" />
    </header>
  );
}
function Hero() {
  const { t } = useText();
  return (
    <section className="hero container">
      <div className="hero-copy">
        <p className="eyebrow">{t.hero.eyebrow}</p>
        <h1>
          {t.hero.title}
          <br />
          <em>{t.hero.accent}</em>
        </h1>
        <p className="hero-description">{t.hero.text}</p>
        <div className="hero-actions">
          <a className="button" href="/procedures">
            {t.hero.cta}
          </a>
          <a className="text-link" href="/about">
            {t.hero.secondary}
          </a>
        </div>
        <p className="hero-note">
          <Leaf size={17} />
          {t.hero.note}
        </p>
      </div>
      <div className="hero-art">
        <span className="hero-orb hero-orb-one" aria-hidden="true" />
        <span className="hero-orb hero-orb-two" aria-hidden="true" />
        <img
          src={settings.images.hero}
          alt={t.hero.imageAlt}
          fetchPriority="high"
          width="1024"
          height="1536"
        />
        <div className="hero-caption">
          <Sparkles size={20} />
          <span>{t.hero.caption}</span>
        </div>
        <span className="vertical-label">{t.brand} · {t.city}</span>
      </div>
    </section>
  );
}
type TurnstileApi = {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
  reset: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}
function Captcha({
  siteKey,
  onToken,
  generation,
}: {
  siteKey: string;
  onToken: (t: string) => void;
  generation: number;
}) {
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!siteKey) return;
    let disposed = false,
      widget: string | undefined;
    const render = () => {
      if (!disposed && holder.current && window.turnstile)
        widget = window.turnstile.render(holder.current, {
          sitekey: siteKey,
          action: "booking",
          callback: onToken,
          "expired-callback": () => onToken(""),
          "error-callback": () => onToken(""),
        });
    };
    let script = document.getElementById(
      "turnstile-script",
    ) as HTMLScriptElement | null;
    if (window.turnstile) render();
    else {
      if (!script) {
        script = document.createElement("script");
        script.id = "turnstile-script";
        script.src =
          "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", render);
    }
    return () => {
      disposed = true;
      script?.removeEventListener("load", render);
      if (widget && window.turnstile) window.turnstile.remove(widget);
    };
  }, [siteKey, onToken, generation]);
  return <div ref={holder} className="captcha" />;
}
function PricingNotes({ services }: { services: Snapshot[] }) {
  const { t } = useText();
  return <>
    {services.some(p => p.priceType === "from") && <p className="price-note">{t.pricing.minimumNote}</p>}
    {services.some(p => p.price === null || p.priceType === "on_request") && <p className="price-note">{t.pricing.onRequestNote}</p>}
    {services.some(p => p.placeholderPrice) && <p className="price-note">{t.services.priceNote}</p>}
  </>;
}
const cartKey = "dr-zulfiya-procedures";
function savedSelection(): string[] {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(cartKey) || "[]");
    if (!Array.isArray(saved)) return [];
    let duration = 0;
    return catalog.procedures.filter(p => {
      if (!p.enabled || !saved.includes(p.id) || duration + p.duration > settings.maxDurationMinutes) return false;
      duration += p.duration;
      return true;
    }).map(p => p.id);
  } catch { return []; }
}
function BookingSection({ runtime, testMode = false }: { runtime: Runtime | null; testMode?: boolean }) {
  const { t, lang } = useText();
  const Heading = testMode ? "h2" : "h1";
  const [category, setCategory] = useState("all"),
    [selected, setSelected] = useState<string[]>(() => testMode ? [] : savedSelection()),
    [stage, setStage] = useState(false);
  const [date, setDate] = useState(localDate()),
    [start, setStart] = useState<number | null>(null);
  const [slots, setSlots] = useState<{ start: number; available: boolean }[]>(
      [],
    ),
    [loading, setLoading] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [name, setName] = useState(""),
    [phone, setPhone] = useState("+7"),
    [consent, setConsent] = useState(false),
    [whatsappConsent, setWhatsappConsent] = useState(false),
    [website, setWebsite] = useState("");
  const [error, setError] = useState(""),
    [sending, setSending] = useState(false),
    [captchaToken, setCaptchaToken] = useState(""),
    [captchaGeneration, setCaptchaGeneration] = useState(0);
  const attempt = useRef<{ key: string; token: string } | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [catalogVisible, setCatalogVisible] = useState(false);
  useEffect(() => {
    // Храним только выбор процедур на время вкладки, без имени и телефона.
    if (!testMode) try { sessionStorage.setItem(cartKey, JSON.stringify(selected)); } catch { /* Приватный режим может запретить хранилище. */ }
  }, [selected, testMode]);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setCatalogVisible(entry.isIntersecting));
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);
  const services = catalog.procedures.filter((p) => selected.includes(p.id));
  const total = totalAmount(services),
    duration = services.reduce((n, p) => n + p.duration, 0);
  const ids = selected.join(",");
  useEffect(() => {
    setStart(null);
    setSlots([]);
    if (!stage || !ids) return;
    const controller = new AbortController();
    setLoading(true);
    api<{ slots: typeof slots }>(
      `/api/slots?date=${date}&ids=${encodeURIComponent(ids)}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setSlots(result.slots);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(message(err, lang));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [date, ids, stage, refresh, lang]);
  const toggle = (id: string) => {
    setSelected(list => {
      if (list.includes(id)) return list.filter(x => x !== id);
      const next = [...list, id];
      // Ограничение действует и при быстрых нажатиях до следующего рендера.
      return catalog.procedures.filter(p => next.includes(p.id)).reduce((sum, p) => sum + p.duration, 0)
        <= settings.maxDurationMinutes ? next : list;
    });
    setStart(null);
  };
  const showForm = () => {
    setStage(true);
    setTimeout(
      () =>
        formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      40,
    );
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!start) {
      setError(t.services.chooseTime);
      return;
    }
    if (duration > settings.maxDurationMinutes) {
      setError(t.errors.tooLong);
      return;
    }
    if (!consent) {
      setError(t.errors.consent);
      return;
    }
    const normalized = "+" + phone.replace(/\D/g, "");
    if (!/^\+7[67]\d{9}$/.test(normalized)) {
      setError(t.errors.invalid);
      return;
    }
    const payload = {
      name,
      phone: normalized,
      lang,
      start,
      procedureIds: selected,
      consent,
      whatsappConsent: runtime?.whatsappEnabled === true && whatsappConsent,
      website,
    };
    const key = JSON.stringify(payload);
    if (attempt.current?.key !== key)
      attempt.current = {
        key,
        token: [...crypto.getRandomValues(new Uint8Array(32))]
          .map((n) => n.toString(16).padStart(2, "0"))
          .join(""),
      };
    setSending(true);
    try {
      const result = await api<PublicBooking>(
        testMode ? "/api/admin/test-bookings" : "/api/bookings",
        post({
          ...payload,
          token: attempt.current.token,
          turnstile: captchaToken,
        }),
      );
      if (!testMode) try { sessionStorage.removeItem(cartKey); } catch { /* Запись уже создана; отсутствие хранилища не мешает подтверждению. */ }
      window.location.assign(
        `/confirmation/${result.id}#token=${attempt.current.token}&lang=${lang}`,
      );
    } catch (err) {
      setError(message(err, lang));
      setCaptchaToken("");
      setCaptchaGeneration((n) => n + 1);
      if (err instanceof ApiError && ["busy", "expired"].includes(err.code)) {
        setStart(null);
        setRefresh((n) => n + 1);
        attempt.current = null;
      }
    } finally {
      setSending(false);
    }
  };
  return (
    <section id="services" ref={sectionRef} className="section services-section">
      <div className="container">
        <div className="services-intro">
        <div className="section-heading">
          <p className="eyebrow">{t.services.eyebrow}</p>
          <Heading>{t.services.title}</Heading>
          <p>{t.services.text}</p>
        </div>
          <ol className="booking-steps" aria-label={t.services.bookingSteps}>
            {[t.services.step1, t.services.step2, t.services.step3].map((label, index) =>
              <li key={label} className={index === (stage ? 1 : 0) ? "active" : ""}>
                <span className="step-number">{index + 1}</span>{label}
              </li>)}
          </ol>
        </div>
        <div className="booking-layout">
          <div className="catalog-browser">
            <div className="category-tabs" aria-label={t.nav.services}>
              <button
                className={category === "all" ? "active" : ""}
                aria-pressed={category === "all"}
                onClick={() => setCategory("all")}
              >
                {t.services.all}
                <small>{catalog.procedures.length}</small>
              </button>
              {catalog.categories.map((c) => (
                <button
                  key={c.id}
                  className={category === c.id ? "active" : ""}
                  aria-pressed={category === c.id}
                  onClick={() => setCategory(c.id)}
                >
                  {c.label[lang]}
                  <small>{catalog.procedures.filter(p => p.category === c.id).length}</small>
                </button>
              ))}
            </div>
            <p className="catalog-hint"><Sparkles size={16} aria-hidden="true" />{t.services.catalogHint}</p>
            {duration >= settings.maxDurationMinutes && <p className="catalog-limit" role="status">{t.services.limitReached}</p>}
            <div className="procedure-groups">
              {catalog.categories.filter(c => category === "all" || c.id === category).map(c => {
                const Icon = ({ cleansing: Droplets, injections: Sparkles, contouring: Heart, peeling: Leaf, additional: Flower2 })[c.id] || Sparkles;
                const group = catalog.procedures.filter(p => p.category === c.id);
                return <section className="procedure-group" key={c.id} aria-labelledby={`group-${c.id}`}>
                  <header className="procedure-group-heading">
                    <span className="category-emblem" aria-hidden="true"><Icon size={25} strokeWidth={1.25} /></span>
                    <div><span className="group-number">0{catalog.categories.indexOf(c) + 1} /</span><h3 id={`group-${c.id}`}>{c.label[lang]}</h3></div>
                    <span className="group-count" aria-hidden="true">{group.length.toString().padStart(2, "0")}</span>
                  </header>
                  <div className="treatment-list">{group.map(p => {
                    const chosen = selected.includes(p.id);
                    const blocked = !p.enabled || (!chosen && duration + p.duration > settings.maxDurationMinutes);
                    return <label className={`procedure treatment-row ${chosen ? "selected" : ""} ${blocked ? "disabled" : ""}`} key={p.id}>
                      <input type="checkbox" checked={chosen} disabled={blocked}
                        aria-label={`${p.name[lang]} — ${priceLabel(p, lang)}`} onChange={() => toggle(p.id)} />
                      <span className="treatment-icon" aria-hidden="true"><Icon size={19} strokeWidth={1.35} /></span>
                      <div className="treatment-copy">
                        <h4>{p.name[lang]}</h4><p>{p.description[lang]}</p>
                        {(!p.enabled || p.placeholderPrice) && <small>{p.enabled ? t.services.example : t.services.consult}</small>}
                      </div>
                      <div className="treatment-choice">
                        <strong className="treatment-price">{priceLabel(p, lang)}</strong>
                        <span className="treatment-toggle" aria-hidden="true">{chosen ? <Check size={16} /> : <Plus size={16} />}<span>{chosen ? t.services.added : t.services.add}</span></span>
                      </div>
                    </label>;
                  })}</div>
                </section>;
              })}
            </div>
          </div>
          <aside className="summary visit-summary">
            <p className="summary-eyebrow">{t.services.visitLabel}</p>
            <div className="summary-heading">
              <span className="round-icon">
                <Heart size={19} />
              </span>
              <h3>{t.services.selection}</h3>
              <span className="count">{selected.length}</span>
            </div>
            {services.length ? (
              <ul className="selection-list">
                {services.map((p) => (
                  <li key={p.id}>
                    <span>
                      {p.name[lang]}<small>{priceLabel(p, lang)}</small>
                    </span>
                    <button
                      className="icon-button"
                      onClick={() => toggle(p.id)}
                      aria-label={`${t.services.remove}: ${p.name[lang]}`}
                    >
                      <X size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-selection"><span className="empty-selection-art" aria-hidden="true"><Flower2 size={42} strokeWidth={1} /></span><p>{t.services.empty}</p></div>
            )}
            <div className="totals" aria-live="polite" aria-atomic="true">
              <div className="sum">
                <span>{t.services.total}</span>
                <strong>{totalLabel(services, lang, total)}</strong>
              </div>
            </div>
            <button
              className="button full"
              disabled={
                !services.length || duration > settings.maxDurationMinutes
              }
              onClick={showForm}
            >
              {t.services.next}
              <ArrowUpRight size={18} aria-hidden="true" />
            </button>
            {duration > settings.maxDurationMinutes && (
              <p className="error">{t.errors.tooLong}</p>
            )}
            <a className="button secondary full question-button" href={`https://wa.me/${settings.contact.whatsapp}`} target="_blank" rel="noreferrer"><Phone size={16} />{t.services.question}</a>
            <PricingNotes services={services} />
            <p className="summary-security">
              <ShieldCheck size={15} />
              {t.services.timezone}
            </p>
          </aside>
        </div>
        {catalogVisible && services.length > 0 && !stage && <div className="mobile-selection">
          <div><span>{t.services.count}: {services.length}</span><strong>{totalLabel(services, lang, total)}</strong></div>
          <button className="button" onClick={showForm} disabled={duration > settings.maxDurationMinutes}>{t.services.next}<ArrowUpRight size={17} aria-hidden="true" /></button>
        </div>}
        {stage && (
          <div className="booking-form" ref={formRef}>
            <div className="form-heading">
              <span className="round-icon">
                <CalendarDays size={22} />
              </span>
              <div>
                <h3>{t.services.step2}</h3>
                <p>{t.services.timezone}</p>
              </div>
              <button className="text-link" onClick={() => setStage(false)}>
                {t.services.back}
              </button>
            </div>
            <form onSubmit={submit}>
              <div className="form-columns">
                <div>
                  <label className="field">
                    <span>{t.services.date}</span>
                    <input
                      type="date"
                      value={date}
                      min={localDate()}
                      max={localDate(
                        Date.now() + settings.maxAdvanceDays * 86400000,
                      )}
                      required
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </label>
                  <div className="slots-heading">
                    <span>{t.services.time}</span>
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => setRefresh((n) => n + 1)}
                    >
                      {t.services.refresh}
                    </button>
                  </div>
                  {loading ? (
                    <p className="loading">
                      <LoaderCircle className="spinner" size={18} />
                      {t.services.loading}
                    </p>
                  ) : !services.length ? (
                    <p>{t.services.chooseFirst}</p>
                  ) : (
                    <>
                      <div className="slots">
                        {slots.map((s) => (
                          <button
                            key={s.start}
                            type="button"
                            disabled={!s.available}
                            className={start === s.start ? "chosen" : ""}
                            aria-pressed={start === s.start}
                            onClick={() => setStart(s.start)}
                          >
                            {new Intl.DateTimeFormat(lang, {
                              timeZone: settings.timezone,
                              hour: "2-digit",
                              minute: "2-digit",
                              hourCycle: "h23",
                            }).format(new Date(s.start))}
                          </button>
                        ))}
                      </div>
                      {!slots.some((s) => s.available) && (
                        <p className="muted">{t.services.noSlots}</p>
                      )}
                    </>
                  )}
                </div>
                <div className="client-fields">
                  <h4>{t.services.step3}</h4>
                  <label className="field">
                    <span>{t.services.name}</span>
                    <input
                      name="name"
                      autoComplete="given-name"
                      value={name}
                      minLength={2}
                      maxLength={80}
                      required
                      placeholder={t.services.namePlaceholder}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>{t.services.phone}</span>
                    <input
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={phone}
                      required
                      placeholder="+7 (___) ___-__-__"
                      onChange={(e) => setPhone(maskPhone(e.target.value))}
                    />
                  </label>
                  <div className="honeypot" aria-hidden="true">
                    <label>
                      {t.services.honeypot}
                      <input
                        name="website"
                        value={website}
                        tabIndex={-1}
                        autoComplete="off"
                        onChange={(e) => setWebsite(e.target.value)}
                      />
                    </label>
                  </div>
                  <label className="consent">
                    <input
                      type="checkbox"
                      checked={consent}
                      required
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    <span>
                      {t.services.consent}{" "}
                      <a href="/privacy" target="_blank" rel="noreferrer">
                        {t.services.privacy}
                      </a>
                    </span>
                  </label>
                  {runtime?.whatsappEnabled && (
                    <label className="consent">
                      <input type="checkbox" checked={whatsappConsent}
                        onChange={(e) => setWhatsappConsent(e.target.checked)} />
                      <span>{t.services.whatsappConsent}</span>
                    </label>
                  )}
                  <Captcha
                    siteKey={runtime?.turnstileSiteKey || ""}
                    onToken={setCaptchaToken}
                    generation={captchaGeneration}
                  />
                  <button
                    className="button full"
                    disabled={
                      sending ||
                      !start ||
                      !services.length ||
                      loading ||
                      !runtime?.bookingEnabled ||
                      (!!runtime.turnstileSiteKey && !captchaToken)
                    }
                  >
                    {sending
                      ? t.services.sending
                      : `${t.services.submit} · ${totalLabel(services, lang, total)}`}
                  </button>
                  {runtime && !runtime.bookingEnabled && (
                    <p className="muted">{t.errors.bookingDisabled}</p>
                  )}
                  <div role="alert" aria-live="polite">
                    {error && <p className="error">{error}</p>}
                  </div>
                </div>
              </div>
            </form>
          </div>
        )}
      </div>
    </section>
  );
}
function About() {
  const { t, lang } = useText();
  const [image, setImage] = useState<{ src: string; title: string } | null>(
    null,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (image) dialog.current?.showModal();
    else dialog.current?.close();
  }, [image]);
  const certificates = settings.certificates as {
    src: string;
    title: { ru: string; kk: string };
  }[];
  return (
    <section id="about" className="section container">
      <div className="about-layout">
        <div className="master-photo">
          {settings.images.master ? (
            <img
              src={settings.images.master}
              alt={t.about.name}
              loading="lazy"
            />
          ) : (
            <div className="photo-placeholder">
              <span>
                {t.brandMark}
              </span>
              <p>{t.about.photo}</p>
            </div>
          )}
          <div className="master-label">
            <span>{t.about.name}</span>
            <small>{t.about.role}</small>
          </div>
        </div>
        <div className="about-copy">
          <p className="eyebrow">{t.about.eyebrow}</p>
          <h1>
            {t.about.title}
            <br />
            <em>{t.about.accent}</em>
          </h1>
          <p>{t.about.text}</p>
          <ul className="principles">
            {t.about.principles.map((p, i) => (
              <li key={p}>
                {i === 0 ? <Leaf /> : i === 1 ? <ShieldCheck /> : <Heart />}
                <span>{p}</span>
              </li>
            ))}
          </ul>
          <div className="hero-actions">
            <a className="button" href="/procedures">{t.hero.cta}</a>
            <a className="text-link" href={`https://wa.me/${settings.contact.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">{t.contacts.whatsapp}</a>
          </div>
        </div>
      </div>
      <div className="education-section" id="certificates">
        <div className="section-heading"><p className="eyebrow">{t.pages.education}</p><h2>{t.about.certificates}</h2></div>
          {certificates.length ? (
            <div className="certificates">
              {certificates.map((c) => (
                <button
                  key={c.src}
                  onClick={() => setImage({ src: c.src, title: c.title[lang] })}
                >
                  <img src={c.src} loading="lazy" alt={c.title[lang]} />
                  <span>{c.title[lang]}</span>
                </button>
              ))}
            </div>
          ) : <div className="certificate-note"><ShieldCheck size={28} strokeWidth={1.3} aria-hidden="true" /><p>{t.about.certificateEmpty}</p></div>}
      </div>
      <dialog
        ref={dialog}
        onCancel={() => setImage(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setImage(null);
        }}
      >
        <button
          className="icon-button dialog-close"
          aria-label={t.about.close}
          onClick={() => setImage(null)}
        >
          <X />
        </button>
        {image && (
          <>
            <img src={image.src} alt={image.title} />
            <p>{image.title}</p>
          </>
        )}
      </dialog>
    </section>
  );
}
function Reviews() {
  const { lang } = useText();
  return <ReviewsSection lang={lang} />;
}

function Contacts() {
  const { t } = useText();
  const hours = Object.entries(settings.workingHours);
  return (
    <section id="contacts" className="section container">
      <div className="contact-layout">
        <div>
          <p className="eyebrow">{t.contacts.eyebrow}</p>
          <h2>{t.contacts.title}</h2>
          <div className="contact-row">
            <MapPin />
            <div>
              <small>{t.contacts.addressTitle}</small>
              <p>{t.contacts.address}</p>
            </div>
          </div>
          <div className="contact-row">
            <Phone />
            <div>
              <small>{t.contacts.phoneTitle}</small>
              {settings.contact.phone ? (
                <a href={`tel:${settings.contact.phone}`}>
                  {maskPhone(settings.contact.phone)}
                </a>
              ) : (
                <p>{t.contacts.missingPhone}</p>
              )}
            </div>
          </div>
          <div className="contact-row">
            <Clock3 />
            <div>
              <small>{t.contacts.hoursTitle}</small>
              <div className="hours">
                {hours.map(([day, periods]) => (
                  <div key={day}>
                    <span>{t.contacts.days[Number(day)]}</span>
                    <span>
                      {periods.length
                        ? periods.map((p) => p.join("–")).join(" / ")
                        : t.contacts.closed}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="contact-actions">
            {settings.contact.whatsapp ? (
              <a
                className="button"
                href={`https://wa.me/${settings.contact.whatsapp.replace(/\D/g, "")}`}
                target="_blank"
                rel="noreferrer"
              >
                {t.contacts.whatsapp}
              </a>
            ) : (
              <button className="button" disabled>
                {t.contacts.whatsapp}
              </button>
            )}
            {settings.contact.instagram ? (
              <a
                className="text-link"
                href={settings.contact.instagram}
                target="_blank"
                rel="noreferrer"
              >
                {t.contacts.instagram}
              </a>
            ) : (
              <span className="muted">{t.contacts.instagram}</span>
            )}
          </div>
        </div>
        <div className="map">
          <iframe
            title={t.contacts.mapTitle}
            src={settings.contact.mapEmbed}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
          <p>
            <MapPin size={16} />
            {t.contacts.mapNote}
          </p>
          <a
            className="map-link"
            href={settings.contact.mapUrl}
            target="_blank"
            rel="noreferrer"
          >
            {t.contacts.openMap}
          </a>
        </div>
      </div>
    </section>
  );
}
function Footer() {
  const { t } = useText();
  return (
    <footer className="footer">
      <span className="footer-orb footer-orb-one" aria-hidden="true" />
      <span className="footer-orb footer-orb-two" aria-hidden="true" />
      <div className="container footer-content">
        <div className="footer-invitation">
          <div>
            <p className="eyebrow"><Sparkles size={15} aria-hidden="true" />{t.footer.eyebrow}</p>
            <h2>{t.footer.title}<br /><em>{t.footer.accent}</em></h2>
            <p className="footer-description">{t.footer.text}</p>
          </div>
          <a className="footer-book bubble-link" href="/procedures">
            <ArrowUpRight size={32} strokeWidth={1.2} aria-hidden="true" />
            <span>{t.services.submit}</span>
          </a>
        </div>
        <div className="footer-links">
          <div className="footer-location">
            <span className="footer-label">{t.city} · {t.studio}</span>
            <a href={settings.contact.mapUrl} target="_blank" rel="noreferrer">{t.contacts.address}<ArrowUpRight size={17} aria-hidden="true" /></a>
          </div>
          <nav className="footer-nav" aria-label={t.footer.navigation}>
            {(Object.keys(publicPages) as PublicPage[]).map(key => <a key={key} href={publicPages[key]}>{t.nav[key]}</a>)}
            <a href="/#contacts">{t.nav.contacts}</a>
          </nav>
          <div className="footer-social">
            {settings.contact.whatsapp && <a className="footer-pill bubble-link" href={`https://wa.me/${settings.contact.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">{t.contacts.whatsapp}<ArrowUpRight size={18} aria-hidden="true" /></a>}
            {settings.contact.phone && <a className="footer-phone" href={`tel:${settings.contact.phone}`}>{maskPhone(settings.contact.phone)}</a>}
          </div>
        </div>
        <div className="footer-wordmark-stage">
          <span className="footer-wordmark">{t.brand}</span>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} {t.brand} · {t.city}</span>
          <div className="footer-legal"><a href="/privacy">{t.footer.privacy}</a><a href="/admin">{t.footer.admin}</a></div>
          <a className="footer-back bubble-link" href="#top">{t.footer.backToTop}<ArrowUp size={16} aria-hidden="true" /></a>
        </div>
      </div>
    </footer>
  );
}
function HomeOverview() {
  const { t } = useText();
  const cards = [
    { key: "services", icon: Flower2 },
    { key: "about", icon: Leaf },
    { key: "reviews", icon: Heart },
  ] as const;
  return <section className="home-overview section container">
    <div className="home-introduction">
      <div><p className="eyebrow">{t.pages.home.eyebrow}</p><h2>{t.pages.home.title}<br /><em>{t.pages.home.accent}</em></h2></div>
      <div><p>{t.pages.home.text}</p><a className="location-chip" href="#contacts"><MapPin size={17} aria-hidden="true" />{t.pages.home.location}<ArrowUpRight size={17} aria-hidden="true" /></a></div>
    </div>
    <div className="discovery-grid">{cards.map(({ key, icon: Icon }, index) => <a className={`discovery-card discovery-${key}`} key={key} href={publicPages[key]}>
      <div className="discovery-top"><span className="discovery-icon"><Icon size={27} strokeWidth={1.25} aria-hidden="true" /></span><span>0{index + 1}</span></div>
      <h3>{t.pages.home[key].title}</h3><p>{t.pages.home[key].text}</p>
      <span className="discovery-link">{t.pages.home[key].link}<ArrowUpRight size={21} aria-hidden="true" /></span>
    </a>)}</div>
  </section>;
}
function PublicSite({ runtime, page }: { runtime: Runtime | null; page: PublicPage | null }) {
  const { t } = useText();
  const root = useRef<HTMLDivElement>(null);
  useLandingMotion(root);
  return <div className={`landing-page public-page page-${page || "missing"}`} id="top" ref={root}>
    <a className="skip-link" href="#main-content">{t.pages.skip}</a>
    <Header active={page} />
    <main id="main-content">
      {page && page !== "home" && <nav className="page-trail container" aria-label={t.pages.breadcrumb}>
        <a href="/">{t.nav.home}</a><span aria-hidden="true">/</span><span aria-current="page">{t.nav[page]}</span>
      </nav>}
      {page === "home" ? <><Hero /><HomeOverview /><Contacts /></>
        : page === "about" ? <About />
        : page === "services" ? <BookingSection runtime={runtime} />
        : page === "reviews" ? <Reviews />
        : <section className="section container missing-page"><p className="eyebrow">404</p><h1>{t.pages.missing.title}</h1><p>{t.pages.missing.text}</p><a className="button" href="/">{t.nav.home}</a></section>}
    </main>
    <Footer />
  </div>;
}
function Confirmation({ runtime }: { runtime: Runtime | null }) {
  const { t, lang } = useText();
  const [booking, setBooking] = useState<PublicBooking | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const token =
      new URLSearchParams(location.hash.slice(1)).get("token") || "";
    api<PublicBooking>(`/api/bookings/${location.pathname.split("/").pop()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(setBooking)
      .catch(() => setError(t.confirmation.missing));
  }, [t]);
  return (
    <>
      <div className="simple-header container">
        <Brand />
        <LangSwitch />
      </div>
      <main className="receipt">
        <span className="receipt-icon">
          {booking?.status === "cancelled" ? <X /> : <Check />}
        </span>
        <h1>
          {booking?.status === "cancelled"
            ? t.confirmation.cancelled
            : t.confirmation.title}
        </h1>
        {error ? (
          <p className="error">{error}</p>
        ) : !booking ? (
          <p>{t.confirmation.loading}</p>
        ) : (
          <>
            <p>{t.confirmation.text}</p>
            <dl>
              <div>
                <dt>{t.confirmation.number}</dt>
                <dd>{booking.id.slice(0, 8)}</dd>
              </div>
              <div>
                <dt>{t.confirmation.date}</dt>
                <dd>{dateLabel(booking.start_at, lang)}</dd>
              </div>
            </dl>
            <h3>{t.confirmation.procedures}</h3>
            <ul className="receipt-services">
              {booking.services.map((p) => (
                <li key={p.id}>
                  <span>
                    {p.name[lang]}
                  </span>
                  <strong>{priceLabel(p, lang)}</strong>
                </li>
              ))}
            </ul>
            <div className="receipt-total">
              <span>{t.services.total}</span>
              <strong>{totalLabel(booking.services, lang, booking.total)}</strong>
            </div>
            <PricingNotes services={booking.services} />
            {booking.status === "confirmed" && (
              <p className="muted">
                {runtime?.whatsappEnabled && booking.whatsappConsent
                  ? t.confirmation.reminder
                  : t.confirmation.offline}
              </p>
            )}
          </>
        )}
        <a className="button" href="/">
          {t.confirmation.back}
        </a>
      </main>
    </>
  );
}
type AdminBooking = PublicBooking & {
  notifications: {
    kind: string;
    status: string;
    provider_id?: string;
    delivery?: string;
    error?: string;
  }[];
};
function Admin({ runtime }: { runtime: Runtime | null }) {
  const { t, lang } = useText();
  const [loggedIn, setLoggedIn] = useState(false),
    [checked, setChecked] = useState(false);
  const [password, setPassword] = useState(""),
    [date, setDate] = useState(localDate()),
    [status, setStatus] = useState(""),
    [rows, setRows] = useState<AdminBooking[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0),
    [hasMore, setHasMore] = useState(false);
  const load = async () => {
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams();
      if (date) query.set("date", date);
      if (status) query.set("status", status);
      query.set("page", String(page));
      const result = await api<{ rows: AdminBooking[]; hasMore: boolean }>(
        `/api/admin/bookings?${query}`,
      );
      setRows(result.rows);
      setHasMore(result.hasMore);
      setLoggedIn(true);
    } catch (err) {
      if (
        err instanceof ApiError &&
        ["unauthorized", "setup"].includes(err.code)
      )
        setLoggedIn(false);
      else setError(message(err, lang));
    } finally {
      setBusy(false);
      setChecked(true);
    }
  };
  useEffect(() => {
    void load();
  }, [date, status, lang, page]);
  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api("/api/admin/login", post({ password }));
      setPassword("");
      await load();
    } catch (err) {
      setError(message(err, lang));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async (id: string) => {
    const whatsapp = runtime?.whatsappEnabled && rows.find(b => b.id === id)?.whatsappConsent;
    if (!window.confirm(whatsapp ? t.admin.confirmWhatsApp : t.admin.confirm)) return;
    setBusy(true);
    try {
      await api(`/api/admin/bookings/${id}/cancel`, post({}));
      await load();
    } catch (err) {
      setError(message(err, lang));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="simple-header container">
        <Brand />
        <LangSwitch />
      </div>
      <main className="admin container">
        <h1>{loggedIn ? t.admin.title : t.admin.loginTitle}</h1>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!checked ? (
          <LoaderCircle className="spinner" />
        ) : !loggedIn ? (
          <form className="login-form" onSubmit={login}>
            <LockKeyhole size={30} />
            <label className="field">
              <span>{t.admin.password}</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button
              className="button full"
              disabled={busy || !runtime?.adminConfigured}
            >
              {t.admin.login}
            </button>
            {runtime && !runtime.adminConfigured && <p>{t.admin.setup}</p>}
          </form>
        ) : (
          <>
            <div className="admin-toolbar">
              <a className="button secondary" href="/admin/test-booking">{t.admin.testBooking}</a>
              <label className="field">
                <span>{t.admin.date}</span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setPage(0);
                  }}
                />
              </label>
              <label className="field">
                <span>{t.admin.status}</span>
                <select
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">{t.admin.all}</option>
                  {["confirmed", "cancel_pending", "cancelled"].map((s) => (
                    <option key={s} value={s}>
                      {t.admin[s as "confirmed"]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void load()}
              >
                {t.admin.refresh}
              </button>
              <button
                className="text-link"
                onClick={async () => {
                  await api("/api/admin/logout", post({}));
                  setLoggedIn(false);
                }}
              >
                {t.admin.logout}
              </button>
            </div>
            <p className="muted">{t.admin.note}</p>
            {!rows.length && !busy && <p>{t.admin.empty}</p>}
            <div className="admin-list">
              {rows.map((b) => (
                <article key={b.id} className="admin-card">
                  <div className="admin-card-top">
                    <h3>{b.name}</h3>
                    <span className={`status ${b.status}`}>
                      {t.admin[b.status as "confirmed"]}
                    </span>
                  </div>
                  <a href={`tel:${b.phone}`}>{b.phone}</a>
                  <p>
                    <CalendarDays size={16} />
                    {dateLabel(b.start_at, lang)}
                  </p>
                  <p>{b.services.map((p) => p.name[lang]).join(", ")}</p>
                  <strong>
                    {totalLabel(b.services, lang, b.total)}
                  </strong>
                  <div className="notice-list">
                    {b.notifications.map((n) => (
                      <span
                        key={n.kind}
                        title={[n.provider_id, n.delivery, n.error]
                          .filter(Boolean)
                          .join(" · ")}
                      >
                        {n.kind === "telegram"
                          ? "Telegram"
                          : n.kind === "reminder"
                            ? t.admin.reminderLabel
                            : t.admin.cancelled}
                        : {t.admin[n.status as "pending"] || n.status}
                        {n.delivery ? ` · ${n.delivery}` : ""}
                      </span>
                    ))}
                  </div>
                  {b.status === "confirmed" && (
                    <button
                      className="button secondary small"
                      disabled={busy}
                      onClick={() => void cancel(b.id)}
                    >
                      {t.admin.cancel}
                    </button>
                  )}
                </article>
              ))}
            </div>
            <div className="admin-pagination">
              <button
                className="button secondary small"
                disabled={busy || page === 0}
                onClick={() => setPage((n) => n - 1)}
              >
                {t.admin.previous}
              </button>
              <button
                className="button secondary small"
                disabled={busy || !hasMore}
                onClick={() => setPage((n) => n + 1)}
              >
                {t.admin.next}
              </button>
            </div>
          </>
        )}
        {loggedIn && <AdminReviews lang={lang} />}
        <a className="text-link" href="/">
          {t.admin.home}
        </a>
      </main>
    </>
  );
}
function TestBooking({ runtime }: { runtime: Runtime | null }) {
  const { t } = useText();
  return <>
    <div className="simple-header container"><Brand /><LangSwitch /></div>
    <div className="container">
      <h1>{t.admin.testBooking}</h1>
      <p>{t.admin.testNote}</p>
      <a href="/admin" className="text-link">{t.admin.title}</a>
    </div>
    {!runtime ? <LoaderCircle className="spinner" /> : runtime.bookingEnabled
      ? <BookingSection runtime={runtime} testMode />
      : <p className="container">{t.admin.testLogin} <a href="/admin">{t.admin.login}</a></p>}
  </>;
}
function Privacy({ runtime }: { runtime: Runtime | null }) {
  const { t } = useText();
  return (
    <>
      <div className="simple-header container">
        <Brand />
        <LangSwitch />
      </div>
      <main className="privacy container">
        <h1>{t.privacy.title}</h1>
        {t.privacy.paragraphs.map((p) => (
          <p key={p}>{p}</p>
        ))}
        {runtime?.whatsappEnabled && <p>{t.privacy.whatsapp}</p>}
        <a className="button" href="/">
          {t.privacy.back}
        </a>
      </main>
    </>
  );
}
function App() {
  const path = normalizePath(location.pathname);
  const page = publicPage(path);
  const initialLang =
    new URLSearchParams(location.hash.slice(1)).get("lang") ||
    localStorage.getItem("aru-language");
  const [lang, setLang] = useState<Lang>(initialLang === "kk" ? "kk" : "ru"),
    [runtime, setRuntime] = useState<Runtime | null>(null);
  useEffect(() => {
    const followLegacyLink = () => {
      const target = legacyDestination();
      if (target) location.replace(target + location.search);
    };
    window.addEventListener("hashchange", followLegacyLink);
    return () => window.removeEventListener("hashchange", followLegacyLink);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", page ? translations[lang].pages.descriptions[page] : translations[lang].hero.text);
    const title = page ? translations[lang].nav[page] : path === "/privacy" ? translations[lang].privacy.title : path.startsWith("/admin") ? translations[lang].admin.title : path.startsWith("/confirmation/") ? translations[lang].confirmation.title : translations[lang].pages.missing.title;
    document.title = `${title} · ${translations[lang].brand} · ${translations[lang].city}`;
    localStorage.setItem("aru-language", lang);
  }, [lang, page, path]);
  useEffect(() => {
    api<Runtime>(location.pathname === "/admin/test-booking" ? "/api/admin/test-config" : "/api/config")
      .then(setRuntime)
      .catch(() =>
        setRuntime({
          bookingEnabled: false,
          notificationsEnabled: false,
          whatsappEnabled: false,
          turnstileSiteKey: "",
          adminConfigured: false,
        }),
      );
  }, []);
  return (
    <Language.Provider value={{ lang, setLang }}>
      {path.startsWith("/confirmation/") ? (
        <Confirmation runtime={runtime} />
      ) : path === "/admin/test-booking" ? (
        <TestBooking runtime={runtime} />
      ) : path === "/admin" ? (
        <Admin runtime={runtime} />
      ) : path === "/privacy" ? (
        <Privacy runtime={runtime} />
      ) : (
        <PublicSite runtime={runtime} page={page} />
      )}
    </Language.Provider>
  );
}
// Старые ссылки на секции сохраняют смысл после разделения сайта.
function legacyDestination() {
  return normalizePath(location.pathname) === "/" ? ({ "#services": "/procedures", "#about": "/about", "#reviews": "/reviews" } as Record<string, string>)[location.hash] : undefined;
}
const legacyPage = legacyDestination();
if (legacyPage) location.replace(legacyPage + location.search);
else createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
