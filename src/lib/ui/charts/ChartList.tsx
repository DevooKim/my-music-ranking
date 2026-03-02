"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import type { ChartItem as ChartListItem } from "@/lib/charts/types";
import Link from "next/link";

/* eslint-disable @next/next/no-img-element */

type ChartType = "weekly" | "monthly" | "yearly";

const MOBILE_BREAKPOINT = 640;
const ITEM_HEIGHT = 98;
const ITEM_HEIGHT_MOBILE = 78;
const ITEM_GAP_MOBILE = 10;
const ITEM_GAP = 10;

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
      isMobile ? ITEM_HEIGHT_MOBILE + ITEM_GAP_MOBILE : ITEM_HEIGHT + ITEM_GAP,
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
              const artistNames = Array.isArray(item.artistNames)
                ? item.artistNames
                : [];
              const artistIds = Array.isArray(item.artistIds) ? item.artistIds : [];

              const statusText = toEntryStatusText(item.entryStatus);
              const rankDelta = item.lastRank === null ? null : item.lastRank - item.rank;
              const rankDeltaText =
                statusText === null && rankDelta !== null
                  ? rankDelta === 0
                ? "-"
                : `${rankDelta > 0 ? "▲" : "▼"} ${Math.abs(rankDelta)}`
              : null;
          const peakText = item.peakRank === null ? "-" : `${item.peakRank}`;
          const shouldShowPeakWeeks = item.peakRank !== null || item.weeksOnChart !== null;
          const hasCoverImage = item.albumImageUrl && item.albumImageUrl.length > 0;
          const deltaClass =
            rankDelta === null || rankDelta === 0
              ? "text-[#9ca3af]"
              : rankDelta > 0
                ? "text-[#1ed760]"
                : "text-[#f97373]";
          const rowSize = virtualRow.size ??
            (isMobile ? ITEM_HEIGHT_MOBILE + ITEM_GAP_MOBILE : ITEM_HEIGHT + ITEM_GAP);
          const visualHeight = Math.max(56, rowSize - ITEM_GAP);
          const topOffset = ITEM_GAP / 2;
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
              <div className="flex h-full w-full items-center gap-2 rounded-xl border border-white/10 bg-[#0e121b] px-3 transition-colors hover:bg-[#141c2a] sm:gap-4 sm:px-4">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1ed760] text-sm font-bold text-[#04100a]">
                  {item.rank}
                </span>
                {hasCoverImage ? (
                  <a
                    href={spotifyAlbumUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${item.albumName} 앨범 링크`}
                    className="hover:underline"
                  >
                    {/* biome-ignore lint/performance/noImgElement: album cover thumbnail from processed data URL */}
                    <img
                      src={item.albumImageUrl}
                      alt={item.albumName || item.trackName}
                      className="h-10 w-10 shrink-0 rounded-lg object-cover sm:h-12 sm:w-12"
                      loading="lazy"
                    />
                  </a>
                ) : null}
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
                    {artistNames.length === 0
                      ? "-"
                      : artistNames.map((artistName, index) => {
                          const artistId = artistIds[index];
                          const isLast = index === artistNames.length - 1;
                          return (
                            <span key={`${item.trackId}-${artistName}-${index}`}>
                              {artistId ? (
                                <a
                                  href={`https://open.spotify.com/artist/${artistId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="select-text cursor-pointer hover:underline"
                                >
                                  {artistName}
                                </a>
                              ) : (
                                <span className="select-text cursor-text">{artistName}</span>
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
                  {shouldShowPeakWeeks ? (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-[#7b8494]">
                      <span className="font-medium text-[#d1dce9]">
                        PEAK {peakText}
                      </span>
                      <span>WEEKS {item.weeksOnChart ?? "-"}</span>
                    </div>
                  ) : null}
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
                  {shouldShowPeakWeeks ? (
                    <div className="flex items-center justify-end gap-2">
                      <span className="font-medium">PEAK {peakText}</span>
                      <span className="text-[10px] text-[#7b8494]">
                        WEEKS {item.weeksOnChart ?? "-"}
                      </span>
                    </div>
                  ) : null}
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
  <Link
    href={href}
    className="rounded-full border border-white/20 bg-black/20 px-4 py-2 text-sm font-medium text-white hover:bg-white/10"
  >
    {label}
  </Link>
);
