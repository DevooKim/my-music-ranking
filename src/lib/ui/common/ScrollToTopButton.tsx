"use client";

import { useEffect, useState } from "react";

export const ScrollToTopButton = () => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setIsVisible(window.scrollY > 260);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const handleClick = () => {
    window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  };

  if (!isVisible) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="맨 위로 이동"
      className="fixed bottom-6 right-4 z-40 inline-flex size-11 animate-[fadeIn_0.2s_ease] items-center justify-center rounded-full border border-white/20 bg-[#1ed760] text-[#04100a] shadow-[0_10px_24px_rgba(0,0,0,0.35)] transition hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1ed760]/80 sm:right-6 sm:bottom-8 sm:size-12"
    >
      <span className="text-lg font-bold leading-none sm:text-xl">↑</span>
    </button>
  );
};

