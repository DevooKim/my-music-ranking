import Link from "next/link";
import type { MonthPeriod, WeekPeriod, YearPeriod } from "@/lib/charts/period";
import { moveMonthPeriod, moveYearPeriod } from "@/lib/charts/period";

/* eslint-disable @next/next/no-img-element */

export type SiteScope = "weekly" | "monthly" | "yearly" | "trends";

type SiteHeaderProps = {
  activeScope: SiteScope;
  periods: {
    weekly: WeekPeriod;
    monthly: MonthPeriod;
    yearly: YearPeriod;
  };
};

const pad2 = (value: number): string => String(value).padStart(2, "0");

const tabClass = (active: boolean): string =>
  `rounded-full px-2.5 py-1.5 text-center ${active ? "bg-[#1ed760] text-[#04100a]" : "border border-white/20 text-white hover:bg-white/10"} sm:px-4`;

export const SiteHeader = ({ activeScope, periods }: SiteHeaderProps) => {
  const lastMonth = moveMonthPeriod(periods.monthly, -1);
  const lastYear = moveYearPeriod(periods.yearly, -1);
  const monthly = activeScope === "monthly" ? periods.monthly : lastMonth;
  const yearly = activeScope === "yearly" ? periods.yearly : lastYear;

  return (
    <header className="sticky top-0 z-10 border-b border-white/10 bg-[#0b1020]/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
        <Link href="/" className="flex items-center gap-3">
          <img
            src="/logo.svg"
            alt="My Music Ranking logo"
            className="h-9 w-auto flex-none sm:h-10"
          />
          <span className="text-sm font-semibold tracking-[0.12em] text-[#b7ffe0] sm:text-base">
            My Music Ranking
          </span>
        </Link>
        <nav className="grid w-full grid-cols-4 gap-2 text-xs sm:flex sm:w-auto sm:gap-2 sm:text-sm">
          <Link href="/" className={tabClass(activeScope === "weekly")}>
            주간
          </Link>
          <Link
            href={`/monthly/${monthly.year}/${pad2(monthly.month)}`}
            className={tabClass(activeScope === "monthly")}
          >
            월간
          </Link>
          <Link
            href={`/yearly/${yearly.year}`}
            className={tabClass(activeScope === "yearly")}
          >
            연간
          </Link>
          <Link href="/trends" className={tabClass(activeScope === "trends")}>
            그래프
          </Link>
        </nav>
      </div>
    </header>
  );
};
