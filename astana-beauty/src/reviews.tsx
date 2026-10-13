import React, { useEffect, useRef, useState } from "react";
import { X, Plus, LoaderCircle } from "lucide-react";
import { translations, dateLabel, type Lang } from "./shared";
import staticReviews from "../data/reviews.json";

type Review = { id: string; name: string; text: string; status: string; createdAt: number; imageUrl: string | null };
type Photo = { data: string; type: string };
async function call<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json() as T & { code?: string };
  if (!response.ok) throw new Error(result.code || "unavailable");
  return result;
}
function errorText(error: unknown, lang: Lang) {
  const code = error instanceof Error ? error.message : "unavailable";
  return translations[lang].errors[code as keyof typeof translations.ru.errors] || translations[lang].errors.unavailable;
}
function ReviewImage({ src, lang }: { src: string; lang: Lang }) {
  const t = translations[lang].reviewForm;
  const dialog = useRef<HTMLDialogElement>(null);
  return <>
    <button type="button" className="review-image" onClick={() => dialog.current?.showModal()} aria-label={t.enlarge}>
      <img src={src} alt={t.screenshot} loading="lazy" />
      <small>{t.enlarge}</small>
    </button>
    <dialog ref={dialog} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <button type="button" className="icon-button dialog-close" aria-label={t.close} onClick={() => dialog.current?.close()}><X /></button>
      <img src={src} alt={t.screenshot} loading="lazy" />
    </dialog>
  </>;
}
function ReviewCard({ review, lang }: { review: Review; lang: Lang }) {
  return <article className="review">
    {review.text && <><span className="quote-mark" aria-hidden="true">“</span><p>{review.text}</p></>}
    {review.imageUrl && <ReviewImage src={review.imageUrl} lang={lang} />}
    <div className="review-person"><span className="avatar">{review.name.slice(0, 1)}</span>
      <div><strong>{review.name}</strong>{review.createdAt > 0 && <small>{dateLabel(review.createdAt, lang).split(",")[0]}</small>}</div>
    </div>
  </article>;
}
export function ReviewsSection({ lang }: { lang: Lang }) {
  const t = translations[lang], f = t.reviewForm;
  const [rows, setRows] = useState<Review[]>([]), [open, setOpen] = useState(false), [sent, setSent] = useState(false);
  const [name, setName] = useState(""), [text, setText] = useState(""), [consent, setConsent] = useState(false), [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    call<{ rows: Review[] }>("/api/reviews").then(result => { if (active) setRows(result.rows); })
      .catch(err => { if (active) setError(errorText(err, lang)); });
    return () => { active = false; };
  }, [lang]);
  const existing: Review[] = staticReviews.filter(r => !r.sample).map(r => ({ id: `static-${r.id}`, name: r.name, text: r.text[lang], status: "published", createdAt: 0, imageUrl: null }));
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await call("/api/reviews", { name, text, consent, website, lang });
      setSent(true); setName(""); setText(""); setConsent(false);
    } catch (err) { setError(errorText(err, lang)); }
    finally { setBusy(false); }
  }
  return <section id="reviews" className="section reviews-section"><div className="container">
    <div className="section-heading centered"><p className="eyebrow">{t.reviews.eyebrow}</p>
      <h2>{t.reviews.title} <em>{t.reviews.accent}</em></h2><p>{t.reviews.text}</p>
      <button type="button" className="button secondary review-open" onClick={() => { setOpen(!open); setError(""); }}>{open ? f.close : f.leave}</button>
    </div>
    {open && <form className="review-form" onSubmit={submit}>
      <h3>{f.title}</h3><p>{f.moderation}</p>
      {sent ? <p role="status" className="success-message">{f.sent}</p> : <>
        <label className="field"><span>{f.name}</span><input value={name} minLength={2} maxLength={80} required autoComplete="given-name" onChange={e => setName(e.target.value)} /></label>
        <label className="field"><span>{f.text}</span><textarea value={text} minLength={10} maxLength={1500} rows={5} required onChange={e => setText(e.target.value)} /></label>
        <div className="honeypot" aria-hidden="true"><label>{f.website}<input value={website} onChange={e => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" /></label></div>
        <label className="consent"><input type="checkbox" required checked={consent} onChange={e => setConsent(e.target.checked)} /><span>{f.consent}</span></label>
        <button className="button" disabled={busy}>{busy ? f.sending : f.submit}</button>
      </>}
      {error && <p className="error" role="alert">{error}</p>}
    </form>}
    {!rows.length && !existing.length && <p className="review-empty">{f.empty}</p>}
    <div className="review-grid">{[...rows, ...existing].map(r => <ReviewCard key={r.id} review={r} lang={lang} />)}</div>
  </div></section>;
}

async function compressPhoto(file: File): Promise<Photo> {
  if (file.size > 8_000_000 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("imageInvalid");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("imageInvalid");
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.9, 0.8, 0.65, 0.5]) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= 750_000) {
        return await new Promise<Photo>((resolve, reject) => {
          const reader = new FileReader(); reader.onerror = () => reject(new Error("imageInvalid"));
          reader.onload = () => resolve({ data: String(reader.result).split(",")[1], type: "image/jpeg" }); reader.readAsDataURL(blob);
        });
      }
    }
    throw new Error("imageInvalid");
  } finally { bitmap.close(); }
}
export function AdminReviews({ lang }: { lang: Lang }) {
  const t = translations[lang].reviewAdmin;
  const [rows, setRows] = useState<Review[]>([]), [name, setName] = useState(""), [text, setText] = useState("");
  const [photo, setPhoto] = useState<Photo | null>(null), [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const load = async () => { const result = await call<{ rows: Review[] }>("/api/admin/reviews"); setRows(result.rows); };
  useEffect(() => { void load().catch(err => setError(errorText(err, lang))); }, [lang]);
  const status = async (id: string, value: string) => {
    setBusy(true); setError("");
    try { await call(`/api/admin/reviews/${id}/status`, { status: value }); await load(); }
    catch (err) { setError(errorText(err, lang)); } finally { setBusy(false); }
  };
  async function upload(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await call("/api/admin/reviews", { name: name.trim() || t.client, text, image: photo, consent, lang });
      setPhoto(null); setName(""); setText(""); setConsent(false); if (fileInput.current) fileInput.current.value = "";
      await load();
    } catch (err) { setError(errorText(err, lang)); } finally { setBusy(false); }
  }
  return <section className="admin-reviews">
    <div className="admin-reviews-heading"><h2>{t.title}</h2><button type="button" className="button secondary" disabled={busy} onClick={() => void load().catch(err => setError(errorText(err, lang)))}>{t.refresh}</button></div>
    <p className="muted">{t.note}</p>
    <form className="review-form" onSubmit={upload}><h3>{t.add}</h3>
      <label className="field"><span>{t.name}</span><input value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
      <label className="field"><span>{t.text}</span><textarea value={text} rows={3} minLength={photo ? undefined : 10} maxLength={1500} required={!photo} onChange={e => setText(e.target.value)} /></label>
      <label className="field"><span>{t.image}</span><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={async e => {
        const file = e.target.files?.[0]; setPhoto(null); if (!file) return; setBusy(true); setError("");
        try { setPhoto(await compressPhoto(file)); } catch (err) { setError(errorText(err, lang)); } finally { setBusy(false); }
      }} /></label>
      <p className="muted">{t.imageNote}</p>
      {photo && <img className="review-upload-preview" src={`data:${photo.type};base64,${photo.data}`} alt={translations[lang].reviewForm.screenshot} />}
      <label className="consent"><input type="checkbox" required checked={consent} onChange={e => setConsent(e.target.checked)} /><span>{t.consent}</span></label>
      <button className="button" disabled={busy}><Plus size={16} />{busy ? t.saving : t.save}</button>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    {!rows.length && <p className="muted">{t.empty}</p>}
    <div className="review-grid">{rows.map(r => <div key={r.id} className="moderated-review">
      <ReviewCard review={r} lang={lang} />
      <div className="review-actions"><span>{t[r.status as "pending"]}</span><button type="button" className="button secondary" disabled={busy} onClick={() => void status(r.id, r.status === "published" ? "hidden" : "published")}>{r.status === "published" ? t.hide : t.publish}</button></div>
    </div>)}</div>
  </section>;
}
