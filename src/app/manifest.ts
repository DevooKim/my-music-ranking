import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "my-music-ranking",
    short_name: "My Music Ranking",
    description:
      "My Music Ranking - 주간/월간/연간 랭킹을 빠르게 확인할 수 있는 앱",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#02060e",
    theme_color: "#02060e",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/pwa-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable",
      },
      {
        src: "/pwa-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
  };
}
