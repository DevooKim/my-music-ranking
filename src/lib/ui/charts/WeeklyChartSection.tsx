"use client";

import { useQuery } from "@tanstack/react-query";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildArtistChartItems } from "@/lib/charts/artist-ranking";
import { fetchArtistThumbnails } from "@/lib/charts/artist-thumbnail-query";
import type { ArtistChartItem, ChartItem } from "@/lib/charts/types";
import { ChartList } from "@/lib/ui/charts/ChartList";

/* eslint-disable @next/next/no-img-element */

const MOBILE_BREAKPOINT = 640;
const ITEM_HEIGHT = 98;
const ITEM_HEIGHT_MOBILE = 78;
const ITEM_GAP_MOBILE = 10;
const ITEM_GAP = 10;

type WeeklyChartSectionProps = {
  items: ChartItem[];
  artistItems?: ArtistChartItem[];
  initialViewMode?: ViewMode;
};

type ViewMode = "track" | "artist";

type ArtistChartListProps = {
  items: ArtistChartItem[];
  onVisibleArtistIdsChange?: (artistIds: string[]) => void;
};

const ArtistChartList = ({
  items,
  onVisibleArtistIdsChange,
}: ArtistChartListProps) => {
  const isMobile =
    typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT;
  const listRef = useRef<HTMLDivElement | null>(null);
  const lastVisibleIdsRef = useRef("");
  const rowHeight = isMobile ? ITEM_HEIGHT_MOBILE : ITEM_HEIGHT;
  const rowGap = isMobile ? ITEM_GAP_MOBILE : ITEM_GAP;

  const syncVisibleIds = useCallback(
    (virtualizer: ReturnType<typeof useWindowVirtualizer>) => {
      if (!onVisibleArtistIdsChange) return;
      const virtualItems = virtualizer.getVirtualItems();
      if (virtualItems.length === 0) return;

      const visibleArtistIds = [
        ...new Set(
          virtualItems
            .map((virtualRow) => items[virtualRow.index]?.artistId ?? "")
            .filter((artistId) => artistId.length > 0),
        ),
      ];
      const nextKey = visibleArtistIds.join("|");
      if (nextKey === lastVisibleIdsRef.current) return;
      lastVisibleIdsRef.current = nextKey;

      onVisibleArtistIdsChange(visibleArtistIds);
    },
    [items, onVisibleArtistIdsChange],
  );

  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => rowHeight,
    overscan: 4,
    gap: rowGap,
    getItemKey: (index) => items[index]?.artistId ?? index,
    scrollMargin: listRef.current?.offsetTop ?? 0,
    isScrollingResetDelay: 120,
    useScrollendEvent: true,
    rangeExtractor: (range) => {
      const start = Math.max(range.startIndex - range.overscan, 0);
      const end = Math.min(range.endIndex + range.overscan, range.count - 1);
      const indexes: number[] = [];

      for (let index = start; index <= end; index += 1) {
        indexes.push(index);
      }

      const forceCount = Math.min(3, range.count);
      for (let forcedIndex = 0; forcedIndex < forceCount; forcedIndex += 1) {
        if (indexes.includes(forcedIndex)) continue;
        indexes.push(forcedIndex);
      }

      return indexes.sort((a, b) => a - b);
    },
    onChange: syncVisibleIds,
  });

  useEffect(() => {
    syncVisibleIds(virtualizer);
  }, [virtualizer, syncVisibleIds]);

  return (
    <section
      ref={listRef}
      className="rounded-2xl border border-white/10 bg-[#111827]/70 p-2 sm:p-3"
    >
      <ol
        className="relative w-full px-1"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const artist = items[virtualRow.index];
          if (!artist) return null;
          const visualHeight = Math.max(56, virtualRow.size - 10);

          return (
            <li
              key={virtualRow.key}
              className="absolute left-0 w-full"
              style={{
                top: 0,
                transform: `translateY(${virtualRow.start - (virtualizer.options.scrollMargin ?? 0)}px)`,
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
                <p className="text-right font-semibold text-xs text-white sm:text-sm">
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

export const WeeklyChartSection = ({
  items,
  artistItems: providedArtistItems,
  initialViewMode = "track",
}: WeeklyChartSectionProps) => {
  const initialArtistItems = useMemo(
    () => providedArtistItems ?? buildArtistChartItems(items),
    [providedArtistItems, items],
  );
  const [artistItems, setArtistItems] =
    useState<ArtistChartItem[]>(initialArtistItems);
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  const [visibleArtistIds, setVisibleArtistIds] = useState<string[]>([]);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const visibleArtistItemMap = useMemo(
    () =>
      new Map<string, ArtistChartItem>(
        artistItems
          .filter((item) => item.artistId.length > 0)
          .map((item) => [item.artistId, item]),
      ),
    [artistItems],
  );

  useEffect(() => {
    setArtistItems(initialArtistItems);
    setVisibleArtistIds([]);
  }, [initialArtistItems]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());

    if (viewMode === "artist") {
      params.set("view", "artist");
    } else {
      params.delete("view");
    }

    const currentQuery = searchParams.toString();
    const nextQuery = params.toString();
    if (currentQuery === nextQuery) return;

    const nextUrl =
      nextQuery.length > 0 ? `${pathname}?${nextQuery}` : pathname;
    router.replace(nextUrl, { scroll: false });
  }, [pathname, router, searchParams, viewMode]);

  const missingThumbnailArtistIds = useMemo(() => {
    if (viewMode !== "artist" || visibleArtistIds.length === 0) return [];

    return [
      ...new Set(
        visibleArtistIds
          .map((artistId) => visibleArtistItemMap.get(artistId))
          .filter(
            (item): item is ArtistChartItem =>
              item !== undefined && !item.artistImageUrl,
          )
          .map((item) => item.artistId),
      ),
    ];
  }, [visibleArtistIds, visibleArtistItemMap, viewMode]);

  const queryArtistIds = useMemo(
    () => [...missingThumbnailArtistIds].sort((a, b) => a.localeCompare(b)),
    [missingThumbnailArtistIds],
  );

  const { data: thumbnailItems = [] } = useQuery({
    queryKey: ["artist-thumbnails", queryArtistIds],
    queryFn: () => fetchArtistThumbnails(queryArtistIds),
    enabled: queryArtistIds.length > 0 && viewMode === "artist",
    staleTime: 14 * 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  useEffect(() => {
    if (thumbnailItems.length === 0) return;

    const thumbnailMap = new Map<string, string | null>(
      thumbnailItems
        .filter((item) => item.artistId.length > 0)
        .map((item) => [item.artistId, item.thumbnailUrl]),
    );

    setArtistItems((previous) => {
      let changed = false;

      const next = previous.map((item) => {
        if (!item.artistImageUrl) {
          const thumbnailUrl =
            item.artistId.length > 0 ? thumbnailMap.get(item.artistId) : null;
          if (thumbnailUrl) {
            changed = true;
            return {
              ...item,
              artistImageUrl: thumbnailUrl,
            };
          }
        }

        return item;
      });

      return changed ? next : previous;
    });
  }, [thumbnailItems]);

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
        <ArtistChartList
          items={artistItems}
          onVisibleArtistIdsChange={setVisibleArtistIds}
        />
      )}
    </div>
  );
};
