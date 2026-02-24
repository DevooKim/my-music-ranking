"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import type { ChartItem as ChartListItem } from "@/lib/charts/types";

/* eslint-disable @next/next/no-img-element */

type ChartType = "weekly" | "monthly" | "yearly";

const MOBILE_BREAKPOINT = 640;
const ITEM_HEIGHT = 98;
const ITEM_HEIGHT_MOBILE = 78;
const ITEM_GAP_MOBILE = 10;

type Props = {
  items: ChartListItem[];
  chartType?: ChartType;
};

const toEntryStatusText = (status: ChartListItem["entryStatus"]) => {
  if (status === "new") return "NEW";
  if (status === "reentry") return "RE-ENTRY";
  return null;
};

const toStatusClassName = (status: ChartListItem["entryStatus"]) => {
  if (status === "new") {
    return "bg-[#1ed760]/90 text-[#04100a]";
  }
  if (status === "reentry") {
    return "bg-[#2d94ff]/90 text-white";
  }
  return "";
};

const getDeltaLabel = (chartType: ChartType | undefined) => {
  if (chartType === "monthly") return "지난 달 대비";
  if (chartType === "yearly") return "지난 해 대비";
  return "지난 주 대비";
};

export const ChartList = ({ items, chartType }: Props) => {
  const isMobile =
    typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT;

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () =>
      typeof document === "undefined" ? null : document.documentElement,
    estimateSize: () =>
      isMobile ? ITEM_HEIGHT_MOBILE + ITEM_GAP_MOBILE : ITEM_HEIGHT,
    overscan: 6,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const hasNoItems = items.length === 0;

  if (hasNoItems) {
    return (
      <p className="rounded-2xl border border-dashed border-white/15 bg-[#161b23] p-6 text-sm text-[#9ca3af]">
        현재 데이터가 비어 있습니다.
      </p>
    );
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-[#111827]/70 p-2 sm:p-3">
      <ol
        className="relative w-full px-1"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualItems.map((virtualRow) => {
          const item = items[virtualRow.index];
          const statusText = toEntryStatusText(item.entryStatus);
          const rankDelta = item.lastRank === null ? null : item.lastRank - item.rank;
          const rankDeltaText =
            statusText === null && rankDelta !== null
              ? rankDelta === 0
                ? "-"
                : `${rankDelta > 0 ? "▲" : "▼"} ${Math.abs(rankDelta)}`
              : null;
          const peakText = item.peakRank === null ? "-" : `${item.peakRank}`;
          const coverUrl =
            item.albumImageUrl && item.albumImageUrl.length > 0
              ? item.albumImageUrl
              : "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' rx='12' fill='%232a3343'/%3E%3Cpath d='M33 28h30c2.8 0 5 2.2 5 5v25.4c-2.4-1.4-5.2-2.2-8.2-2.2-7.7 0-14 6.3-14 14s6.3 14 14 14c7.7 0 14-6.3 14-14V33c0-1.5-1.5-2.8-3.3-2.8H33c-1.8 0-3.3 1.3-3.3 2.8v30c0 1.5 1.5 2.8 3.3 2.8h1.5V28z' fill='%237af0a6'/%3E%3C/svg%3E";
          const deltaClass =
            rankDelta === null || rankDelta === 0
              ? "text-[#9ca3af]"
              : rankDelta > 0
                ? "text-[#1ed760]"
                : "text-[#f97373]";
          const rowSize = virtualRow.size ??
            (isMobile ? ITEM_HEIGHT_MOBILE + ITEM_GAP_MOBILE : ITEM_HEIGHT);
          const visualHeight = isMobile
            ? Math.max(56, rowSize - ITEM_GAP_MOBILE)
            : rowSize;
          const topOffset = isMobile ? ITEM_GAP_MOBILE / 2 : 0;
          const spotifyAlbumUrl = `https://open.spotify.com/album/${item.albumId}`;

          return (
            <li
              key={item.trackId}
              className="absolute left-0 w-full"
              style={{
                top: `${virtualRow.start + topOffset}px`,
                transform: "translateY(0px)",
                height: `${visualHeight}px`,
              }}
            >
              <div className="flex h-full w-full items-center gap-2 rounded-xl border border-white/10 bg-[#0e121b] px-2.5 py-2 transition-colors hover:bg-[#141c2a] sm:gap-4 sm:px-4 sm:py-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1ed760] text-sm font-bold text-[#04100a]">
                  {item.rank}
                </span>
                <a
                  href={spotifyAlbumUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${item.albumName} 앨범 링크`}
                  className="hover:underline"
                >
                  {/* biome-ignore lint/performance/noImgElement: album cover thumbnail from processed data URL */}
                  <img
                    src={coverUrl}
                    alt={item.albumName || item.trackName}
                    className="h-10 w-10 shrink-0 rounded-lg object-cover sm:h-12 sm:w-12"
                    loading="lazy"
                  />
                </a>
                <div className="min-w-0 flex-1">
                  <a
                    href={spotifyAlbumUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block select-text cursor-pointer hover:underline"
                  >
                    <p className="truncate text-sm font-bold text-[#eef2fb] sm:text-base">
                      {item.trackName}
                    </p>
                  </a>
                  <p className="mt-0.5 truncate text-xs text-[#9ca3af]">
                    {item.artistNames.length === 0
                      ? "-"
                      : item.artistNames.map((artistName, index) => {
                          const artistId = item.artistIds[index];
                          const spotifyArtistUrl = artistId
                            ? `https://open.spotify.com/artist/${artistId}`
                            : null;
                          const isLast = index === item.artistNames.length - 1;
                          return (
                            <span key={`${item.trackId}-${artistName}-${index}`}>
                              {spotifyArtistUrl ? (
                                <a
                                  href={spotifyArtistUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="select-text cursor-pointer hover:underline"
                                >
                                  {artistName}
                                </a>
                              ) : (
                                <span className="select-text cursor-text">
                                  {artistName}
                                </span>
                              )}
                              {!isLast && ", "}
                            </span>
                          );
                        })}
                  </p>
                </div>
                <div className="w-auto text-left text-xs text-[#9ca3af] sm:hidden">
                  <p className="truncate text-[11px] font-semibold text-white">
                    재생 {item.playCount.toLocaleString("ko-KR")}회
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {statusText ? (
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${toStatusClassName(item.entryStatus)}`}
                      >
                        {statusText}
                      </span>
                    ) : null}
                    {rankDeltaText ? (
                      <span
                        className={`truncate text-[10px] font-medium ${deltaClass}`}
                      >
                        {rankDeltaText}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-[#7b8494]">
                    <span className="font-medium text-[#d1dce9]">
                      PEAK {peakText}
                    </span>
                    <span>WEEKS {item.weeksOnChart ?? "-"}</span>
                  </div>
                </div>
                <div className="hidden text-right text-xs text-[#9ca3af] sm:block">
                  <p className="font-semibold text-white">
                    재생 {item.playCount.toLocaleString("ko-KR")}회
                  </p>
                </div>
                <div className="hidden w-44 text-right text-[11px] text-[#d1dce9] sm:block">
                  <div className="mb-2 flex items-center justify-end gap-2">
                    {statusText ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${toStatusClassName(item.entryStatus)}`}
                      >
                        {statusText}
                      </span>
                    ) : null}
                    {rankDeltaText ? (
                      <span className={`font-medium ${deltaClass}`}>
                        {getDeltaLabel(chartType)} {rankDeltaText}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <span className="font-medium">PEAK {peakText}</span>
                    <span className="text-[10px] text-[#7b8494]">
                      WEEKS {item.weeksOnChart ?? "-"}
                    </span>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
};

export const DetailActionButton = ({
  href,
  label,
}: {
  href: string;
  label: string;
}) => (
  <a
    href={href}
    className="rounded-full border border-white/20 bg-black/20 px-4 py-2 text-sm font-medium text-white hover:bg-white/10"
  >
    {label}
  </a>
);
