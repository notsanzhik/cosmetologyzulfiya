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
  Menu,
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
import "./styles.css";

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
function Header() {
  const { t } = useText();
  const [open, setOpen] = useState(false);
  return (
    <header className="header">
      <div className="container header-inner">
        <Brand />
        <nav className={open ? "nav open" : "nav"}>
          {Object.entries(t.nav).map(([key, label]) => (
            <a key={key} href={`/#${key}`} onClick={() => setOpen(false)}>
              {label}
            </a>
          ))}
        </nav>
        <div className="header-controls">
          <LangSwitch />
          <a className="button small header-book" href="#services">
            {t.services.submit}
          </a>
          <button
            className="icon-button mobile-menu"
            aria-label={open ? t.about.close : t.services.selection}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </div>
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
          <a className="button" href="#services">
            {t.hero.cta}
          </a>
          <a className="text-link" href="#about">
            {t.hero.secondary}
          </a>
        </div>
        <p className="hero-note">
          <Leaf size={17} />
          {t.hero.note}
        </p>
      </div>
      <div className="hero-art">
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
function BookingSection({ runtime, testMode = false }: { runtime: Runtime | null; testMode?: boolean }) {
  const { t, lang } = useText();
  const [category, setCategory] = useState("all"),
    [selected, setSelected] = useState<string[]>([]),
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
    setSelected((list) =>
      list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
    );
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
    <section id="services" className="section services-section">
      <div className="container">
        <div className="section-heading">
          <p className="eyebrow">{t.services.eyebrow}</p>
          <h2>{t.services.title}</h2>
          <p>{t.services.text}</p>
        </div>
        <div className="booking-layout">
          <div>
            <div className="category-tabs" aria-label={t.nav.services}>
              <button
                className={category === "all" ? "active" : ""}
                onClick={() => setCategory("all")}
              >
                {t.services.all}
              </button>
              {catalog.categories.map((c) => (
                <button
                  key={c.id}
                  className={category === c.id ? "active" : ""}
                  onClick={() => setCategory(c.id)}
                >
                  {c.label[lang]}
                </button>
              ))}
            </div>
            <div className="procedure-grid">
              {catalog.procedures
                .filter((p) => category === "all" || p.category === category)
                .map((p) => (
                  <label
                    className={`procedure ${selected.includes(p.id) ? "selected" : ""} ${!p.enabled ? "disabled" : ""}`}
                    key={p.id}
                  >
                    <div className="procedure-top">
                      <span className="procedure-category">
                        {
                          catalog.categories.find((c) => c.id === p.category)
                            ?.label[lang]
                        }
                      </span>
                      <input
                        type="checkbox"
                        checked={selected.includes(p.id)}
                        disabled={!p.enabled}
                        onChange={() => toggle(p.id)}
                      />
                      <span className="check-box" aria-hidden="true">
                        {selected.includes(p.id) ? (
                          <Check size={15} />
                        ) : (
                          <Plus size={15} />
                        )}
                      </span>
                    </div>
                    <h3>{p.name[lang]}</h3>
                    <p>{p.description[lang]}</p>
                    <div className="procedure-bottom">
                      <strong>{priceLabel(p, lang)}</strong>
                    </div>
                    <small>
                      {p.enabled
                        ? p.placeholderPrice
                          ? t.services.example
                          : ""
                        : t.services.consult}
                    </small>
                  </label>
                ))}
            </div>
          </div>
          <aside className="summary">
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
                      {p.name[lang]}
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
              <p className="empty-selection">{t.services.empty}</p>
            )}
            <div className="totals">
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
          <h2>
            {t.about.title}
            <br />
            <em>{t.about.accent}</em>
          </h2>
          <p>{t.about.text}</p>
          <ul className="principles">
            {t.about.principles.map((p, i) => (
              <li key={p}>
                {i === 0 ? <Leaf /> : i === 1 ? <ShieldCheck /> : <Heart />}
                <span>{p}</span>
              </li>
            ))}
          </ul>
          {certificates.length > 0 && <h3 className="cert-heading">{t.about.certificates}</h3>}
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
          ) : null}
        </div>
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
      <div className="container footer-top">
        <Brand />
        <p>{t.footer.text}</p>
        <a href="/privacy">{t.footer.privacy}</a>
        <a href="/admin">{t.footer.admin}</a>
      </div>
      <div className="container footer-bottom">
        © {new Date().getFullYear()} {t.brand}. {t.footer.copyright}
      </div>
    </footer>
  );
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
  const initialLang =
    new URLSearchParams(location.hash.slice(1)).get("lang") ||
    localStorage.getItem("aru-language");
  const [lang, setLang] = useState<Lang>(initialLang === "kk" ? "kk" : "ru"),
    [runtime, setRuntime] = useState<Runtime | null>(null);
  useEffect(() => {
    document.documentElement.lang = lang;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", translations[lang].hero.text);
    document.title = `${translations[lang].brand} · ${translations[lang].studio} · ${translations[lang].city}`;
    localStorage.setItem("aru-language", lang);
  }, [lang]);
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
  const path = location.pathname;
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
        <>
          <Header />
          <main>
            <Hero />
            <BookingSection runtime={runtime} />
            <About />
            <Reviews />
            <Contacts />
          </main>
          <Footer />
        </>
      )}
    </Language.Provider>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
