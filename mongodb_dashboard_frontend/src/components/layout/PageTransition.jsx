import React, { useEffect, useRef } from "react";
import { shouldReduceMotion } from "../../utils/motion";

/**
 * PUBLIC_INTERFACE
 * PageTransition
 * Wraps route content with a fade/slide enter animation respecting prefers-reduced-motion.
 *
 * Usage:
 * <PageTransition><YourRouteContent /></PageTransition>
 */
export default function PageTransition({ children, className = "" }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (shouldReduceMotion()) return;

    el.classList.add("pt-enter");
    // trigger transition on next frame
    const id = requestAnimationFrame(() => {
      el.classList.add("pt-enter-active");
    });

    // cleanup: remove classes after transition ends
    function onEnd(e) {
      if (e.target !== el) return;
      el.classList.remove("pt-enter");
      el.classList.remove("pt-enter-active");
      el.removeEventListener("transitionend", onEnd);
    }
    el.addEventListener("transitionend", onEnd);

    return () => {
      cancelAnimationFrame(id);
      el.classList.remove("pt-enter");
      el.classList.remove("pt-enter-active");
      el.removeEventListener("transitionend", onEnd);
    };
  }, []);

  return (
    <div ref={ref} className={`page-transition ${className}`.trim()}>
      {children}
    </div>
  );
}
