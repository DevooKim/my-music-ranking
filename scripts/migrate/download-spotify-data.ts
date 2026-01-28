/**
 * S3에서 spotify-recently-played 데이터를 로컬로 다운로드
 * 연월별로 폴더를 나눠서 저장
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getObjectBody, listAllKeys } from "../utils/s3";

const DOWNLOAD_DIR = path.join(__dirname, "../../data/spotify-raw");

async function downloadSpotifyData() {
  console.log("📥 S3 데이터 다운로드 시작...\n");

  // 처리할 연월 범위 설정
  const startYearMonth = "202509";
  const now = new Date();
  const endYear = now.getFullYear();
  const endMonth = now.getMonth() + 1;
  const endYearMonth = `${endYear}${String(endMonth).padStart(2, "0")}`;

  // 연월 목록 생성
  const yearMonths: string[] = [];
  let currentYM = startYearMonth;
  while (currentYM <= endYearMonth) {
    yearMonths.push(currentYM);

    const year = Number.parseInt(currentYM.substring(0, 4), 10);
    const month = Number.parseInt(currentYM.substring(4, 6), 10);

    if (month === 12) {
      currentYM = `${year + 1}01`;
    } else {
      currentYM = `${year}${String(month + 1).padStart(2, "0")}`;
    }
  }

  console.log(`처리 대상: ${yearMonths.join(", ")}\n`);

  // 다운로드 디렉토리 생성
  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });

  let totalDownloaded = 0;
  let totalFiles = 0;

  // 연월별로 처리
  for (const yearMonth of yearMonths) {
    const prefix = `spotify-recently-played/${yearMonth}`;
    const keys = await listAllKeys(prefix);

    if (keys.length === 0) {
      console.log(`📅 ${yearMonth}: 파일 없음 (스킵)\n`);
      continue;
    }

    totalFiles += keys.length;
    console.log(
      `📅 ${yearMonth}: ${keys.length}개 파일 다운로드 시작...`,
    );

    // 연월별 폴더 생성
    const yearMonthDir = path.join(DOWNLOAD_DIR, yearMonth);
    await fs.mkdir(yearMonthDir, { recursive: true });

    let downloaded = 0;
    const BATCH_SIZE = 50;

    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
      const batch = keys.slice(i, i + BATCH_SIZE);

      // 배치 내 파일들 병렬 다운로드
      await Promise.all(
        batch.map(async (key) => {
          try {
            const body = await getObjectBody(key);
            if (!body) {
              console.warn(`  - 스킵: ${key} (내용 없음)`);
              return;
            }

            // 파일명 추출
            const fileName = path.basename(key);
            const filePath = path.join(yearMonthDir, fileName);

            // 파일 저장
            await fs.writeFile(filePath, body, "utf-8");
            downloaded++;
            totalDownloaded++;
          } catch (error) {
            console.error(`  - 오류: ${key}`, error);
          }
        }),
      );

      console.log(
        `  - 진행: ${downloaded}/${keys.length} (전체: ${totalDownloaded}/${totalFiles})`,
      );
    }

    console.log(`✅ ${yearMonth} 완료: ${downloaded}개 파일 저장\n`);
  }

  console.log(
    `🎉 다운로드 완료!\n  - 총 ${totalDownloaded}개 파일\n  - 저장 위치: ${DOWNLOAD_DIR}`,
  );
}

downloadSpotifyData().catch((error) => {
  console.error("❌ 다운로드 실패:", error);
  process.exit(1);
});
