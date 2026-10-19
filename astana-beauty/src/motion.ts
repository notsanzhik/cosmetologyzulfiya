import { useEffect, type RefObject } from "react";

/** Двигаем только оформление: размеры блоков и положение полей записи не меняются. */
export function useLandingMotion(root: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const page = root.current;
    if (!page) return;
    // Логотип теперь изображение: ширину задаёт CSS, подгонка шрифта больше не нужна.
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let dispose = () => {};
    const configure = () => {
      dispose();
      if (preference.matches || !("IntersectionObserver" in window)) return;
      const footer = page.querySelector<HTMLElement>(".footer");
      const progress = page.querySelector<HTMLElement>(".scroll-progress");
      const blocks = page.querySelectorAll<HTMLElement>(
        ".section-heading, .category-tabs, .about-layout, .review-grid, .home-introduction, .discovery-card, .contact-layout > div, .footer-invitation, .footer-links",
      );
      page.classList.add("motion-enabled");
      const reveals = new IntersectionObserver(entries => {
        for (const entry of entries) if (entry.isIntersecting) {
          entry.target.classList.add("motion-visible");
          reveals.unobserve(entry.target);
        }
      }, { rootMargin: "0px 0px -24px 0px", threshold: 0.04 });
      blocks.forEach(block => {
        // Уже видимые элементы не прячем даже на перезагрузке посередине страницы.
        if (block.getBoundingClientRect().top < window.innerHeight - 24) return;
        block.classList.add("motion-reveal");
        reveals.observe(block);
      });
      let footerVisible = false;
      const visibility = new IntersectionObserver(entries => {
        footerVisible = entries[0].isIntersecting;
      });
      if (footer) visibility.observe(footer);
      const scrollPosition = () => Math.max(0, Math.min(window.scrollY,
        document.documentElement.scrollHeight - window.innerHeight));
      let previousY = scrollPosition(), scale = 1, frame = 0;
      const update = () => {
        frame = 0;
        const currentY = scrollPosition(), delta = currentY - previousY;
        previousY = currentY;
        const distance = document.documentElement.scrollHeight - window.innerHeight;
        progress?.style.setProperty("--scroll-progress", String(distance > 0 ? currentY / distance : 0));
        if (footerVisible && footer && Math.abs(delta) > 0.5) {
          // Вверх — больше, вниз — меньше. transform не меняет высоту страницы и не вызывает дрожание.
          scale = Math.max(0.74, Math.min(1.02, scale - delta * 0.0028));
          footer.style.setProperty("--wordmark-scale", scale.toFixed(4));
        }
      };
      const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
      window.addEventListener("scroll", schedule, { passive: true });
      window.addEventListener("resize", schedule);
      update();
      dispose = () => {
        cancelAnimationFrame(frame);
        window.removeEventListener("scroll", schedule);
        window.removeEventListener("resize", schedule);
        reveals.disconnect();
        visibility.disconnect();
        page.classList.remove("motion-enabled");
        blocks.forEach(block => block.classList.remove("motion-reveal", "motion-visible"));
        footer?.style.removeProperty("--wordmark-scale");
        progress?.style.removeProperty("--scroll-progress");
      };
    };
    configure();
    preference.addEventListener("change", configure);
    return () => {
      dispose();
      preference.removeEventListener("change", configure);
    };
  }, [root]);
}
