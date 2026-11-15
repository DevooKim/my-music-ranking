"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { fetchArtistThumbnails } from "@/lib/charts/artist-thumbnail-query";
import {
  buildTrendHref,
  formatTrendRange,
  TREND_TOP_N,
  TREND_UNIT_TEXT,
  type TrendPeriod,
  type TrendSeries,
  type TrendUnit,
} from "@/lib/charts/trend-types";

/* eslint-disable @next/next/no-img-element */

export type TrendViewMode = "track" | "artist";

type RankTrendSectionProps = {
  unit: TrendUnit;
  /** 구간 시작부터 쌓은 누적 순위인지 여부 */
  cumulative: boolean;
  rangeOptions: number[];
  defaultRange: Record<TrendUnit, number>;
  periods: TrendPeriod[];
  tracks: TrendSeries[];
  artists: TrendSeries[];
  range: number;
  initialViewMode: TrendViewMode;
};

const ROW_HEIGHT = 36;
/** 맨 위 순위 점 위에 값 말풍선이 들어갈 여백을 포함한다. */
const PLOT_TOP = 38;
const PLOT_BOTTOM = 34;

const PLOT_LEFT = 30;
/** 구간 사이 최소 간격. 이보다 좁아지면 줄이지 않고 가로 스크롤로 넘긴다. */
const MIN_STEP = 48;
const AXIS_WIDTH = 24;
const PLOT_HEIGHT = (TREND_TOP_N - 1) * ROW_HEIGHT;
const SVG_HEIGHT = PLOT_TOP + PLOT_HEIGHT + PLOT_BOTTOM;

const SURFACE = "#0e121b";
const ACCENT = "#1ed760";
const MUTED_LINE = "#465064";
/** 선택된 항목이 없을 때 모든 선에 쓰는 중립 색 */
const NEUTRAL_LINE = "#69758c";

const topRank = (series: TrendSeries, index: number): number | null => {
  const rank = series.points[index]?.rank;
  return rank !== undefined && rank <= TREND_TOP_N ? rank : null;
};

const yOf = (rank: number): number => PLOT_TOP + (rank - 1) * ROW_HEIGHT;

/** 탑 N 안에 연속으로 머문 구간만 부드러운 곡선으로 잇는다. */
const buildPath = (
  series: TrendSeries,
  xOf: (index: number) => number,
): string => {
  let path = "";
  let previous: { x: number; y: number } | null = null;

  series.points.forEach((_, index) => {
    const rank = topRank(series, index);
    if (rank === null) {
      previous = null;
      return;
    }
    const point = { x: xOf(index), y: yOf(rank) };
    if (previous) {
      const midX = (previous.x + point.x) / 2;
      path += ` C${midX},${previous.y} ${midX},${point.y} ${point.x},${point.y}`;
    } else {
      path += ` M${point.x},${point.y}`;
    }
    previous = point;
  });

  return path.trim();
};

/**
 * 항목이 탑 N에서 마지막으로 보인 지점. 그 뒤로는 그래프에서 완전히 빠져
 * 오른쪽 끝 라벨 열에도 나오지 않으므로, 선이 끊긴 자리에 이름을 적어 준다.
 * 마지막 구간까지 남아 있으면 오른쪽 열에 이미 이름이 있어 null이다.
 */
const findLastExit = (
  series: TrendSeries,
  weeks: TrendPeriod[],
): { index: number; rank: number } | null => {
  for (let index = weeks.length - 1; index >= 0; index -= 1) {
    const rank = topRank(series, index);
    if (rank === null) continue;
    if (index === weeks.length - 1) return null;
    // 다음 구간에 차트 자체가 없으면 이탈이 아니라 데이터 공백이다.
    return weeks[index + 1].available ? { index, rank } : null;
  }
  return null;
};

const shortName = (name: string, max = 7): string => {
  const chars = [...name];
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : name;
};

type SeriesSummary = {
  series: TrendSeries;
  currentRank: number | null;
  previousRank: number | null;
  /** 직전 주차에 차트가 있었는지 (변동 계산 가능 여부) */
  hasPreviousWeek: boolean;
  peakRank: number;
  weeksInTop: number;
};

const summarize = (
  series: TrendSeries,
  weeks: TrendPeriod[],
): SeriesSummary => {
  const lastIndex = weeks.length - 1;
  const topRanks = series.points
    .map((_, index) => topRank(series, index))
    .filter((rank): rank is number => rank !== null);

  return {
    series,
    currentRank: topRank(series, lastIndex),
    previousRank:
      lastIndex > 0 ? (series.points[lastIndex - 1]?.rank ?? null) : null,
    hasPreviousWeek: lastIndex > 0 && weeks[lastIndex - 1].available,
    peakRank: Math.min(...topRanks),
    weeksInTop: topRanks.length,
  };
};

const sortSummaries = (summaries: SeriesSummary[]): SeriesSummary[] =>
  [...summaries].sort((a, b) => {
    if (a.currentRank !== null && b.currentRank !== null) {
      return a.currentRank - b.currentRank;
    }
    if (a.currentRank !== null) return -1;
    if (b.currentRank !== null) return 1;
    if (a.peakRank !== b.peakRank) return a.peakRank - b.peakRank;
    return b.weeksInTop - a.weeksInTop;
  });

const describeChange = (summary: SeriesSummary): string => {
  if (summary.currentRank === null) return "차트 아웃";
  if (!summary.hasPreviousWeek) return "–";
  if (summary.previousRank === null) return "NEW";
  const diff = summary.previousRank - summary.currentRank;
  if (diff === 0) return "–";
  return diff > 0 ? `▲ ${diff}` : `▼ ${Math.abs(diff)}`;
};

const useElementWidth = () => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
};

const Thumbnail = ({
  series,
  rounded,
}: {
  series: TrendSeries;
  rounded: boolean;
}) => (
  <div
    className={`h-10 w-10 shrink-0 overflow-hidden bg-white/10 ${rounded ? "rounded-full" : "rounded-md"}`}
  >
    {series.imageUrl ? (
      <img
        src={series.imageUrl}
        alt=""
        className="h-full w-full object-cover"
        loading="lazy"
      />
    ) : null}
  </div>
);

export const RankTrendSection = ({
  unit,
  cumulative,
  rangeOptions,
  defaultRange,
  periods: weeks,
  tracks,
  artists,
  range,
  initialViewMode,
}: RankTrendSectionProps) => {
  const [viewMode, setViewMode] = useState<TrendViewMode>(initialViewMode);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [hover, setHover] = useState<{ id: string; index: number } | null>(
    null,
  );
  const { ref: scrollRef, width: containerWidth } = useElementWidth();

  // 아티스트 이미지가 비어 있으면 기존 썸네일 API로 채운다.
  const missingArtistIds = artists
    .filter((series) => !series.imageUrl)
    .map((series) => series.id)
    .sort((a, b) => a.localeCompare(b));
  const { data: thumbnails = [] } = useQuery({
    queryKey: ["artist-thumbnails", missingArtistIds],
    queryFn: () => fetchArtistThumbnails(missingArtistIds),
    enabled: viewMode === "artist" && missingArtistIds.length > 0,
    staleTime: 14 * 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const thumbnailById = new Map(
    thumbnails.map((item) => [item.artistId, item.thumbnailUrl]),
  );

  const seriesList =
    viewMode === "track"
      ? tracks
      : artists.map((series) => ({
          ...series,
          imageUrl: series.imageUrl ?? thumbnailById.get(series.id) ?? null,
        }));
  const summaries = sortSummaries(
    seriesList.map((series) => summarize(series, weeks)),
  );

  const lastIndex = weeks.length - 1;
  const isNarrow = containerWidth > 0 && containerWidth < 560;
  const labelWidth = isNarrow ? 112 : 190;
  const step =
    lastIndex > 0
      ? Math.max(
          MIN_STEP,
          (containerWidth - PLOT_LEFT - labelWidth) / lastIndex,
        )
      : 0;
  const svgWidth = PLOT_LEFT + step * lastIndex + labelWidth;
  const canScroll = containerWidth > 0 && svgWidth > containerWidth + 1;
  const scrollByPage = (direction: -1 | 1) =>
    scrollRef.current?.scrollBy({
      left: direction * containerWidth * 0.7,
      behavior: "smooth",
    });
  const xOf = (index: number): number => PLOT_LEFT + index * step;
  const labelEvery = Math.max(1, Math.ceil(44 / Math.max(step, 1)));

  // 좁은 화면에서는 가로 스크롤이 생기므로 최신 주차가 보이도록 맞춘다.
  useEffect(() => {
    const element = scrollRef.current;
    if (element && svgWidth > 0) element.scrollLeft = element.scrollWidth;
  }, [scrollRef, svgWidth]);

  // 선택은 기본적으로 없다. 같은 항목을 다시 누르면 선택이 풀린다.
  const pinned =
    pinnedId && summaries.some((item) => item.series.id === pinnedId)
      ? pinnedId
      : null;
  const activeId = hover?.id ?? pinned;
  const togglePinned = (id: string) =>
    setPinnedId((current) => (current === id ? null : id));

  const changeView = (next: TrendViewMode) => {
    setViewMode(next);
    setPinnedId(null);
    setHover(null);
    const params = new URLSearchParams(window.location.search);
    if (next === "artist") params.set("view", "artist");
    else params.delete("view");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      query ? `${window.location.pathname}?${query}` : window.location.pathname,
    );
  };

  const unitText = TREND_UNIT_TEXT[unit];

  const hoveredSeries = hover
    ? seriesList.find((series) => series.id === hover.id)
    : undefined;
  const hoveredPoint = hover ? hoveredSeries?.points[hover.index] : undefined;

  // 활성 시리즈가 다른 선 위에 그려지도록 마지막에 렌더링한다.
  const drawOrder = [...seriesList].sort(
    (a, b) => Number(a.id === activeId) - Number(b.id === activeId),
  );

  const unitLabel = viewMode === "track" ? "트랙" : "아티스트";

  // 목록은 현재 탑 N만 먼저 보여 주고, 차트 아웃된 항목은 펼쳐서 본다.
  const outCount = summaries.filter((item) => item.currentRank === null).length;
  const listed = showAll
    ? summaries
    : summaries.filter(
        (item) => item.currentRank !== null || item.series.id === activeId,
      );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {(["track", "artist"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => changeView(mode)}
              aria-pressed={viewMode === mode}
              className={`rounded-full px-4 py-2 text-sm font-medium ${viewMode === mode ? "bg-[#1ed760] text-[#04100a]" : "border border-white/20 bg-black/20 text-white hover:bg-white/10"}`}
            >
              {mode === "track" ? "트랙별" : "아티스트별"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex gap-1 rounded-full border border-white/15 bg-black/20 p-1 text-sm">
            {(["weekly", "monthly"] as const).map((option) => (
              <Link
                key={option}
                href={buildTrendHref(option, defaultRange[option], viewMode)}
                scroll={false}
                aria-current={option === unit ? "true" : undefined}
                className={`rounded-full px-3 py-1 font-medium ${option === unit ? "bg-white/90 text-[#121212]" : "text-[#b6c2d1] hover:bg-white/10"}`}
              >
                {TREND_UNIT_TEXT[option].name}
              </Link>
            ))}
          </div>
          <div className="flex gap-1 rounded-full border border-white/15 bg-black/20 p-1 text-sm">
            {rangeOptions.map((option) => (
              <Link
                key={option}
                href={buildTrendHref(unit, option, viewMode)}
                scroll={false}
                aria-current={option === range ? "true" : undefined}
                className={`rounded-full px-3 py-1 font-medium ${option === range ? "bg-white/90 text-[#121212]" : "text-[#b6c2d1] hover:bg-white/10"}`}
              >
                {formatTrendRange(unit, option)}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <section className="rounded-2xl border border-white/10 bg-[#0e121b] p-3 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-[#eef2fb]">
              {unitLabel} 탑 {TREND_TOP_N} {cumulative ? "누적 " : ""}순위 변화
            </h2>
          </div>
          {canScroll ? (
            <div className="flex shrink-0 gap-1">
              {([-1, 1] as const).map((direction) => (
                <button
                  key={direction}
                  type="button"
                  onClick={() => scrollByPage(direction)}
                  aria-label={
                    direction === -1
                      ? "이전 기간으로 스크롤"
                      : "다음 기간으로 스크롤"
                  }
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/15 text-sm text-[#b6c2d1] hover:bg-white/10"
                >
                  {direction === -1 ? "←" : "→"}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div
          ref={scrollRef}
          className="mt-3 overflow-x-auto overscroll-x-contain pb-1"
        >
          {containerWidth > 0 ? (
            <div
              className="relative"
              style={{ width: svgWidth, height: SVG_HEIGHT }}
            >
              {/* 가로로 스크롤해도 순위 눈금이 남도록 왼쪽에 고정한다. */}
              <div
                aria-hidden="true"
                className="sticky left-0 z-[2] h-0"
                style={{ width: AXIS_WIDTH }}
              >
                <div
                  className="absolute left-0 top-0 w-full bg-[#0e121b]"
                  style={{ height: SVG_HEIGHT }}
                >
                  {Array.from({ length: TREND_TOP_N }, (_, index) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: 고정 길이 눈금
                      key={index}
                      className="absolute right-1.5 -translate-y-1/2 text-[11px] leading-none text-[#7c8694]"
                      style={{ top: yOf(index + 1) }}
                    >
                      {index + 1}
                    </span>
                  ))}
                </div>
              </div>
              <svg
                width={svgWidth}
                height={SVG_HEIGHT}
                role="img"
                aria-label={`${cumulative ? `${range}년 월별 누적` : `최근 ${weeks.length}${unitText.span} ${unitText.name}`} ${unitLabel} 탑 ${TREND_TOP_N} 순위 변화 그래프`}
                onMouseLeave={() => setHover(null)}
              >
                {Array.from({ length: TREND_TOP_N }, (_, index) => {
                  const rank = index + 1;
                  return (
                    <g key={rank}>
                      <line
                        x1={PLOT_LEFT}
                        x2={xOf(lastIndex)}
                        y1={yOf(rank)}
                        y2={yOf(rank)}
                        stroke="#ffffff"
                        strokeOpacity={0.06}
                      />
                    </g>
                  );
                })}

                {weeks.map((week, index) => {
                  const showLabel = (lastIndex - index) % labelEvery === 0;
                  const isHovered = hover?.index === index;
                  if (!showLabel && !isHovered) return null;
                  return (
                    <text
                      key={week.key}
                      x={xOf(index)}
                      y={SVG_HEIGHT - 10}
                      textAnchor="middle"
                      fontSize={11}
                      fill={isHovered ? "#eef2fb" : "#7c8694"}
                      opacity={hover && !isHovered ? 0.35 : 1}
                    >
                      {week.label}
                    </text>
                  );
                })}

                {drawOrder.map((series) => {
                  const isActive = series.id === activeId;
                  const color = isActive
                    ? ACCENT
                    : activeId === null
                      ? NEUTRAL_LINE
                      : MUTED_LINE;
                  return (
                    <g key={series.id}>
                      <path
                        d={buildPath(series, xOf)}
                        fill="none"
                        stroke={color}
                        strokeWidth={isActive ? 3 : 2}
                        strokeLinecap="round"
                      />
                      {series.points.map((_, index) => {
                        const rank = topRank(series, index);
                        if (rank === null) return null;
                        return (
                          <circle
                            key={weeks[index].key}
                            cx={xOf(index)}
                            cy={yOf(rank)}
                            r={isActive ? 5 : 3.5}
                            fill={color}
                            stroke={SURFACE}
                            strokeWidth={2}
                          />
                        );
                      })}
                      {/* 선택·호버한 항목이 끝까지 남지 못했다면, 마지막으로 보인 지점 오른쪽에 이름을 한 번만 적는다. */}
                      {(() => {
                        const exit = isActive
                          ? findLastExit(series, weeks)
                          : null;
                        if (!exit) return null;
                        return (
                          <text
                            x={xOf(exit.index) + 9}
                            y={yOf(exit.rank)}
                            textAnchor="start"
                            dominantBaseline="central"
                            fontSize={10}
                            fill={ACCENT}
                            fontWeight={700}
                            stroke={SURFACE}
                            strokeWidth={3}
                            paintOrder="stroke"
                            pointerEvents="none"
                          >
                            {shortName(series.name)}
                          </text>
                        );
                      })()}
                    </g>
                  );
                })}

                {/* 히트 영역: 점보다 넓게 잡아 호버·탭을 쉽게 한다. */}
                {seriesList.map((series) =>
                  series.points.map((_, index) => {
                    const rank = topRank(series, index);
                    if (rank === null) return null;
                    return (
                      // biome-ignore lint/a11y/noStaticElementInteractions: 아래 목록이 키보드 접근 경로를 제공한다.
                      <circle
                        key={`${series.id}-${weeks[index].key}`}
                        cx={xOf(index)}
                        cy={yOf(rank)}
                        r={Math.min(ROW_HEIGHT, step) / 2}
                        fill="transparent"
                        className="cursor-pointer"
                        onMouseEnter={() => setHover({ id: series.id, index })}
                        onClick={() => {
                          setPinnedId(series.id);
                          setHover({ id: series.id, index });
                        }}
                      />
                    );
                  }),
                )}
              </svg>

              {/* 최신 주차 순위의 직접 라벨 */}
              {summaries
                .filter((summary) => summary.currentRank !== null)
                .map((summary) => {
                  const isActive = summary.series.id === activeId;
                  return (
                    <button
                      key={summary.series.id}
                      type="button"
                      onClick={() => togglePinned(summary.series.id)}
                      onMouseEnter={() =>
                        setHover({ id: summary.series.id, index: lastIndex })
                      }
                      onMouseLeave={() => setHover(null)}
                      className={`absolute truncate text-left text-xs ${isActive ? "font-bold text-white" : "text-[#9ca3af]"}`}
                      style={{
                        left: xOf(lastIndex) + 14,
                        top: yOf(summary.currentRank ?? 1) - 9,
                        width: labelWidth - 18,
                      }}
                    >
                      {summary.series.name}
                    </button>
                  );
                })}

              {/* 값 말풍선: 위 행과의 빈 줄에 들어가는 작은 크기로 선을 거의 가리지 않는다. */}
              {hover && hoveredSeries && hoveredPoint ? (
                <div
                  className="pointer-events-none absolute z-[3] -translate-x-1/2 whitespace-nowrap rounded-md border border-white/15 bg-[#1b2333] px-2 py-1 text-xs leading-none text-white shadow-md"
                  style={{
                    left: Math.min(
                      Math.max(xOf(hover.index), AXIS_WIDTH + 100),
                      svgWidth - 100,
                    ),
                    top: yOf(hoveredPoint.rank) - 36,
                  }}
                >
                  <span className="font-bold">
                    {shortName(hoveredSeries.name, 14)}
                  </span>
                  <span className="text-[#b6c2d1]">
                    {" · "}
                    {hoveredPoint.rank}위
                  </span>
                  <span className="text-[#b6c2d1]">
                    {" · "}
                    {cumulative ? "누적" : "재생"}{" "}
                    {hoveredPoint.playCount.toLocaleString("ko-KR")}회
                    {cumulative
                      ? ` (+${hoveredPoint.periodPlayCount.toLocaleString("ko-KR")})`
                      : ""}
                  </span>
                </div>
              ) : null}
            </div>
          ) : (
            <div style={{ height: SVG_HEIGHT }} />
          )}
        </div>
        {canScroll ? (
          <p className="mt-1 text-center text-[11px] text-[#7c8694]">
            ← 좌우로 밀어서 다른 기간을 볼 수 있어요 →
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#111827]/70 p-2 sm:p-3">
        <div className="hidden items-center gap-3 px-3 pb-2 pt-1 text-[11px] text-[#7c8694] sm:flex sm:px-4">
          <span className="w-9 text-center">현재</span>
          <span className="flex-1">{unitLabel}</span>
          <span className="w-14 text-right">{unitText.previous}</span>
          <span className="w-10 text-right">최고</span>
          <span className="w-14 text-right">탑 {TREND_TOP_N}</span>
        </div>
        <ol className="space-y-1.5">
          {listed.map((summary) => {
            const { series } = summary;
            const isActive = series.id === activeId;
            return (
              <li key={series.id}>
                <button
                  type="button"
                  onClick={() => togglePinned(series.id)}
                  aria-pressed={series.id === pinned}
                  className={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2.5 text-left transition-colors sm:gap-3 sm:px-4 sm:py-2 ${isActive ? "border-[#1ed760]/70 bg-[#141c2a]" : "border-white/10 bg-[#0e121b] hover:bg-[#141c2a]"}`}
                >
                  <span
                    className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold sm:h-9 sm:w-9 ${summary.currentRank !== null ? "bg-[#1ed760] text-[#04100a]" : "bg-white/10 text-[#9ca3af]"}`}
                  >
                    {summary.currentRank ?? "–"}
                  </span>
                  <Thumbnail series={series} rounded={viewMode === "artist"} />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 break-words text-sm font-bold leading-snug text-[#eef2fb] sm:line-clamp-1">
                      {series.name}
                    </span>
                    {series.subtitle ? (
                      <span className="line-clamp-1 text-xs text-[#9ca3af]">
                        {series.subtitle}
                      </span>
                    ) : null}
                    {/* 모바일: 열을 줄이고 수치는 이름 아래 한 줄로 보여 준다 */}
                    <span className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-[#9ca3af] sm:hidden">
                      <span>{describeChange(summary)}</span>
                      <span>최고 {summary.peakRank}위</span>
                      <span>
                        탑 {TREND_TOP_N} {summary.weeksInTop}
                        {unitText.span}
                      </span>
                    </span>
                  </span>
                  <span className="hidden w-14 shrink-0 text-right text-xs text-[#b6c2d1] sm:block">
                    {describeChange(summary)}
                  </span>
                  <span className="hidden w-10 shrink-0 text-right text-xs text-white sm:block">
                    {summary.peakRank}위
                  </span>
                  <span className="hidden w-14 shrink-0 text-right text-xs text-white sm:block">
                    {summary.weeksInTop}
                    {unitText.span}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        {outCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            aria-expanded={showAll}
            className="mt-2 w-full rounded-xl border border-white/10 px-3 py-2.5 text-sm text-[#b6c2d1] hover:bg-white/5"
          >
            {showAll
              ? `현재 탑 ${TREND_TOP_N}만 보기`
              : `기간 중 탑 ${TREND_TOP_N}에 올랐던 나머지 ${outCount}개 보기`}
          </button>
        ) : null}
      </section>
    </div>
  );
};
