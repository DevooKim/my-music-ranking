export const SHELL_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/pwa-192.png",
  "/pwa-512.png",
  "/pwa-192.svg",
  "/pwa-512.svg",
  "/favicon.ico",
] as const;

export const shouldUseShellCache = (url: string, origin: string): boolean => {
  try {
    const parsed = new URL(url);
    return (
      parsed.origin === origin &&
      SHELL_ASSETS.includes(parsed.pathname as (typeof SHELL_ASSETS)[number])
    );
  } catch {
    return false;
  }
};

export const shouldUseNavigationNetworkFirst = (
  url: string,
  origin: string,
  requestMode: string,
): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.origin === origin && requestMode === "navigate";
  } catch {
    return false;
  }
};
