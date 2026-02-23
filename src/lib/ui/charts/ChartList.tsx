"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import type { ChartItem } from "@/lib/charts/types";

/* eslint-disable @next/next/no-img-element */

const ITEM_HEIGHT = 98;

const toEntryStatusText = (status: ChartItem["entryStatus"]) => {
  if (status === "new") return "NEW";
  if (status === "reentry") return "RE-ENTRY";
  return null;
};

const toStatusClassName = (status: ChartItem["entryStatus"]) => {
  if (status === "new") {
    return "bg-[#1ed760]/90 text-[#04100a]";
  }
  if (status === "reentry") {
    return "bg-[#2d94ff]/90 text-white";
  }
  return "";
};

export const ChartList = ({ items }: { items: ChartItem[] }) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ITEM_HEIGHT,
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
    <section className="rounded-2xl border border-white/10 bg-[#111827]/70 p-2">
      <div ref={parentRef} className="h-[68vh] overflow-auto">
        <ol
          className="relative w-full px-1"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualItems.map((virtualRow) => {
            const item = items[virtualRow.index];
            const statusText = toEntryStatusText(item.entryStatus);
            const rankDelta =
              item.lastRank === null ? null : item.lastRank - item.rank;
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

            return (
              <li
                key={item.trackId}
                className="absolute left-0 flex w-full items-center gap-4 rounded-xl border border-white/10 bg-[#0e121b] px-4 py-3"
                style={{
                  top: virtualRow.start,
                  transform: "translateY(0px)",
                  height: `${virtualRow.size ?? ITEM_HEIGHT}px`,
                }}
              >
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1ed760] text-sm font-bold text-[#04100a]">
                  {item.rank}
                </span>
                {/* biome-ignore lint/performance/noImgElement: album cover thumbnail from processed data URL */}
                <img
                  src={coverUrl}
                  alt={item.albumName || item.trackName}
                  className="h-12 w-12 shrink-0 rounded-lg object-cover"
                  loading="lazy"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">
                    {item.trackName}
                  </p>
                  <p className="truncate text-xs text-[#9ca3af]">
                    {item.artistNames.join(", ")}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-[#b0c2dd]">
                    {item.albumName}
                  </p>
                </div>
                <div className="text-right text-xs text-[#9ca3af]">
                  <p className="font-semibold text-white">
                    재생 {item.playCount.toLocaleString("ko-KR")}회
                  </p>
                </div>
                <div className="w-44 text-right text-[11px] text-[#d1dce9]">
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
                        지난 주 대비 {rankDeltaText}
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
              </li>
            );
          })}
        </ol>
      </div>
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
