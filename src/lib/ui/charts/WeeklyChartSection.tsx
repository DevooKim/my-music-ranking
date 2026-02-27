"use client";

import { useMemo, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { buildArtistChartItems } from "@/lib/charts/artist-ranking";
import type { ChartItem } from "@/lib/charts/types";
import { ChartList } from "@/lib/ui/charts/ChartList";

const MOBILE_BREAKPOINT = 640;
const ITEM_HEIGHT = 82;

type WeeklyChartSectionProps = {
  items: ChartItem[];
};

type ViewMode = "track" | "artist";

const ArtistChartList = ({ items }: { items: ReturnType<typeof buildArtistChartItems> }) => {
  const isMobile =
    typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT;

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () =>
      typeof document === "undefined" ? null : document.documentElement,
    estimateSize: () => (isMobile ? ITEM_HEIGHT - 8 : ITEM_HEIGHT),
    overscan: 8,
  });

  return (
    <section className="rounded-2xl border border-white/10 bg-[#111827]/70 p-2 sm:p-3">
      <ol className="relative w-full px-1" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const artist = items[virtualRow.index];
          return (
            <li
              key={artist.artistId}
              className="absolute left-0 w-full"
              style={{ top: `${virtualRow.start}px`, height: `${virtualRow.size}px` }}
            >
              <a
                href={`https://open.spotify.com/artist/${artist.artistId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-full items-center gap-3 rounded-xl border border-white/10 bg-[#0e121b] px-3 py-2 hover:bg-[#141c2a] sm:px-4"
              >
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1ed760] text-sm font-bold text-[#04100a]">
                  {artist.rank}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-[#eef2fb] sm:text-base">{artist.artistName}</p>
                  <p className="mt-0.5 text-xs text-[#9ca3af]">참여 트랙 {artist.trackCount.toLocaleString("ko-KR")}곡</p>
                </div>
                <p className="text-right text-xs text-[#d1dce9] sm:text-sm">
                  재생 {artist.playCount.toLocaleString("ko-KR")}회
                </p>
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
};

export const WeeklyChartSection = ({ items }: WeeklyChartSectionProps) => {
  const [viewMode, setViewMode] = useState<ViewMode>("track");
  const artistItems = useMemo(() => buildArtistChartItems(items), [items]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setViewMode("track")}
          className={`rounded-full px-4 py-2 text-sm font-medium ${viewMode === "track" ? "bg-[#1ed760] text-[#04100a]" : "border border-white/20 bg-black/20 text-white"}`}
        >
          트랙별
        </button>
        <button
          type="button"
          onClick={() => setViewMode("artist")}
          className={`rounded-full px-4 py-2 text-sm font-medium ${viewMode === "artist" ? "bg-[#1ed760] text-[#04100a]" : "border border-white/20 bg-black/20 text-white"}`}
        >
          아티스트별
        </button>
      </div>

      {viewMode === "track" ? (
        <ChartList items={items} chartType="weekly" />
      ) : (
        <ArtistChartList items={artistItems} />
      )}
    </div>
  );
};
