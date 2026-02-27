import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentPeriods, getLatestWeeklyChart } from "@/lib/charts/service";
import { ChartList } from "@/lib/ui/charts/ChartList";

export default async function ArtistPage({
  params,
}: {
  params: Promise<{ artistId: string }>;
}) {
  const { artistId } = await params;
  const result = await getLatestWeeklyChart();

  if (result.kind !== "found") {
    notFound();
  }

  const artistTracks = result.chart.items
    .filter((item) => item.artistIds.includes(artistId))
    .sort((a, b) => b.playCount - a.playCount)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  if (artistTracks.length === 0) {
    notFound();
  }

  const artistName =
    artistTracks[0].artistNames[artistTracks[0].artistIds.indexOf(artistId)] ??
    "알 수 없는 아티스트";
  const totalPlayCount = artistTracks.reduce((sum, item) => sum + item.playCount, 0);
  const current = getCurrentPeriods();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:gap-6 sm:py-10">
      <div className="flex items-center gap-2">
        <Link href="/" className="rounded-full border border-white/20 px-4 py-2 text-sm text-white">
          주간 차트로 돌아가기
        </Link>
      </div>
      <header className="space-y-2">
        <h1 className="text-3xl font-bold leading-tight text-white sm:text-4xl">{artistName}</h1>
        <p className="text-sm text-[#b6c2d1]">
          이번 주차 ({current.weekly.isoYear}-W{String(current.weekly.isoWeek).padStart(2, "0")}) · 참여 트랙 {artistTracks.length.toLocaleString("ko-KR")}곡 · 총 재생 {totalPlayCount.toLocaleString("ko-KR")}회
        </p>
      </header>
      <ChartList items={artistTracks} chartType="weekly" />
    </main>
  );
}
