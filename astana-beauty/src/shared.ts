import catalog from "../data/procedures.json";
import settings from "../data/config.json";
import ru from "../locales/ru.json";
import kk from "../locales/kk.json";

export type Lang = "ru" | "kk";
export type Procedure = (typeof catalog.procedures)[number];
export type Snapshot = Pick<
  Procedure,
  "id" | "name" | "duration" | "price" | "placeholderPrice"
>;
export const translations = { ru, kk };
export { catalog, settings };
export const money = (n: number, lang: Lang) =>
  new Intl.NumberFormat("ru-RU").format(n) + " ₸";
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
  if (digits.startsWith("7") || digits.startsWith("8"))
    digits = digits.slice(1);
  digits = digits.slice(0, 10);
  return (
    "+7" +
    (digits.length ? " (" + digits.slice(0, 3) : "") +
    (digits.length >= 3 ? ") " : "") +
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
