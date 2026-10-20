import rawCatalog from "../data/procedures.json";
import settings from "../data/config.json";
import ru from "../locales/ru.json";
import kk from "../locales/kk.json";

export type Lang = "ru" | "kk";
export type PriceType = "fixed" | "from" | "on_request";
export type Procedure = {
  id: string;
  category: string;
  name: Record<Lang, string>;
  description: Record<Lang, string>;
  duration: number;
  durationConfirmed?: boolean;
  price: number | null;
  priceType?: PriceType;
  placeholderPrice: boolean;
  enabled: boolean;
};
export const catalog = rawCatalog as {
  categories: { id: string; label: Record<Lang, string> }[];
  procedures: Procedure[];
};
export type Snapshot = Pick<
  Procedure,
  "id" | "name" | "duration" | "price" | "placeholderPrice"
> & Partial<Pick<Procedure, "priceType" | "durationConfirmed">>;
export const translations = { ru, kk };
export { settings };
export const money = (n: number, lang: Lang) =>
  new Intl.NumberFormat("ru-RU").format(n) + " ₸";
type PriceItem = Pick<Snapshot, "price" | "priceType">;
export const totalAmount = (items: PriceItem[]) =>
  items.reduce((sum, item) => sum + (item.price ?? 0), 0);
export function priceLabel(item: PriceItem, lang: Lang) {
  const t = translations[lang].pricing;
  if (item.price === null || item.priceType === "on_request") return t.onRequest;
  const amount = money(item.price, lang);
  return item.priceType === "from" ? t.from.replace("{amount}", amount) : amount;
}
export function totalLabel(items: PriceItem[], lang: Lang, storedTotal?: number) {
  const t = translations[lang].pricing;
  const total = storedTotal ?? totalAmount(items);
  const unknown = items.some(p => p.price === null || p.priceType === "on_request");
  // null обозначает неизвестную цену. Ноль в сумме — только техническая сумма
  // известных позиций; в интерфейсе неизвестная услуга никогда не выглядит бесплатной.
  if (unknown) return total > 0
    ? t.mixed.replace("{amount}", money(total, lang)) : t.onRequest;
  if (items.some(p => p.priceType === "from"))
    return t.from.replace("{amount}", money(total, lang));
  // Старые записи без priceType сохраняют прежнюю фиксированную стоимость.
  return money(total, lang);
}
export function durationLabel(item: Pick<Snapshot, "duration" | "durationConfirmed">, lang: Lang) {
  const t = translations[lang].pricing;
  return (item.durationConfirmed === false ? t.durationApproximate : t.durationExact)
    .replace("{minutes}", String(item.duration));
}
export const dateLabel = (ms: number, lang: Lang) => {
  // Не во всех браузерах есть казахские названия месяцев в Intl.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: settings.timezone,
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  const t = translations[lang].dates;
  return t.pattern.replace("{day}", String(Number(part("day"))))
    .replace("{month}", t.months[Number(part("month")) - 1])
    .replace("{year}", part("year"))
    .replace("{time}", `${part("hour")}:${part("minute")}`);
};
export function localDate(ms = Date.now()): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const part = (key: string) => p.find((x) => x.type === key)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function maskPhone(input: string): string {
  let digits = input.replace(/\D/g, "");
  // В местном 10-значном номере начальная 7 — часть номера, а не код страны.
  if (/^\s*\+7/.test(input) || (/^[78]/.test(digits) && digits.length > 10) || /^\s*8[\s(]/.test(input))
    digits = digits.slice(1);
  digits = digits.slice(0, 10);
  return (
    "+7" +
    (digits.length ? " (" + digits.slice(0, 3) : "") +
    (digits.length > 3 ? ") " : "") +
    digits.slice(3, 6) +
    (digits.length > 6 ? "-" + digits.slice(6, 8) : "") +
    (digits.length > 8 ? "-" + digits.slice(8, 10) : "")
  );
}
export type PublicBooking = {
  id: string;
  name: string;
  phone: string;
  lang: Lang;
  services: Snapshot[];
  total: number;
  duration: number;
  start_at: number;
  status: string;
  whatsappConsent: boolean;
};
