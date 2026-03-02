"use client";

import { useMemo, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { buildArtistChartItems } from "@/lib/charts/artist-ranking";
import type { ChartItem } from "@/lib/charts/types";
import { ChartList } from "@/lib/ui/charts/ChartList";

/* eslint-disable @next/next/no-img-element */

const MOBILE_BREAKPOINT = 640;
const ITEM_HEIGHT = 98;
const ITEM_HEIGHT_MOBILE = 78;
const ITEM_GAP_MOBILE = 10;
const ITEM_GAP = 10;

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
    estimateSize: () =>
      isMobile ? ITEM_HEIGHT_MOBILE + ITEM_GAP_MOBILE : ITEM_HEIGHT + ITEM_GAP,
    overscan: 8,
  });

  return (
    <section className="rounded-2xl border border-white/10 bg-[#111827]/70 p-2 sm:p-3">
      <ol className="relative w-full px-1" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const artist = items[virtualRow.index];
          const rowSize = virtualRow.size ??
            (isMobile ? ITEM_HEIGHT_MOBILE + ITEM_GAP_MOBILE : ITEM_HEIGHT + ITEM_GAP);
          const visualHeight = Math.max(56, rowSize - ITEM_GAP);
          const topOffset = ITEM_GAP / 2;

          return (
            <li
              key={artist.artistId}
              className="absolute left-0 w-full"
              style={{
                top: `${virtualRow.start + topOffset}px`,
                transform: "translateY(0px)",
                height: `${visualHeight}px`,
              }}
            >
              <div className="flex h-full w-full items-center gap-2 rounded-xl border border-white/10 bg-[#0e121b] px-3 transition-colors hover:bg-[#141c2a] sm:gap-4 sm:px-4">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1ed760] text-sm font-bold text-[#04100a]">
                  {artist.rank}
                </span>
                {artist.artistImageUrl ? (
                  <img
                    src={artist.artistImageUrl}
                    alt={artist.artistName}
                    className="h-10 w-10 shrink-0 rounded-full object-cover"
                    loading="lazy"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <a
                    href={`https://open.spotify.com/artist/${artist.artistId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block select-text cursor-pointer hover:underline"
                  >
                    <p className="truncate text-sm font-bold text-[#eef2fb] sm:text-base">
                      {artist.artistName}
                    </p>
                  </a>
                  <p className="mt-0.5 text-xs text-[#9ca3af]">
                    트랙 {artist.trackCount.toLocaleString("ko-KR")}곡
                  </p>
                </div>
                <p className="text-right text-xs text-[#d1dce9] sm:text-sm">
                  재생 {artist.playCount.toLocaleString("ko-KR")}회
                </p>
              </div>
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
    <div className="space-y-5">
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
