import type { ChartItem } from "@/lib/charts/types";

const formatTotalPlayTime = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
};

export const ChartList = ({ items }: { items: ChartItem[] }) => {
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-500">
        현재 데이터가 비어 있습니다.
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {items.map((item) => (
        <li
          key={item.trackId}
          className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm"
        >
          <div className="flex items-center gap-4">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-semibold text-zinc-500">
              {item.rank}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-zinc-900">{item.trackName}</p>
              <p className="truncate text-sm text-zinc-600">{item.artistNames.join(", ")}</p>
            </div>
            <div className="text-right text-sm text-zinc-600">
              <p>재생 수: {item.playCount.toLocaleString("ko-KR")}회</p>
              <p>총 재생시간: {formatTotalPlayTime(item.totalDurationMs)}</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            이전위치 {item.lastRank === null ? "신규" : `${item.lastRank}위`} ·
            최고위 {item.peakRank === null ? "-" : `${item.peakRank}위`} ·
            잔류주 {item.weeksOnChart === null ? "-" : `${item.weeksOnChart}주`}
          </p>
        </li>
      ))}
    </ol>
  );
};

export const DetailActionButton = ({ href, label }: { href: string; label: string }) => (
  <a
    href={href}
    className="rounded-full border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
  >
    {label}
  </a>
);
