// Адреса общие для меню и сервера: прямые ссылки открывают нужную страницу.
export const publicPages = {
  home: "/",
  about: "/about",
  services: "/procedures",
  reviews: "/reviews",
} as const;
export type PublicPage = keyof typeof publicPages;
export function normalizePath(path: string) {
  return path.replace(/\/+$/, "") || "/";
}
export function publicPage(path: string): PublicPage | null {
  const normalized = normalizePath(path);
  return (Object.keys(publicPages) as PublicPage[]).find(key => publicPages[key] === normalized) ?? null;
}
export function isAppPath(path: string) {
  const normalized = normalizePath(path);
  return publicPage(normalized) !== null || ["/admin", "/admin/test-booking", "/privacy"].includes(normalized)
    || /^\/confirmation\/[^/]+$/.test(normalized);
}
