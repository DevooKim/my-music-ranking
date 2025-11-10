# My Music Ranking

음악 랭킹 관리 프로젝트입니다. Next.js와 Neon Database (PostgreSQL), Drizzle ORM을 사용합니다.

## Tech Stack

- **Framework**: Next.js 16
- **Database**: Neon (PostgreSQL)
- **ORM**: Drizzle ORM
- **Styling**: Tailwind CSS
- **Language**: TypeScript

## Database Setup

### 1. Neon Database 설정

1. [Neon Console](https://console.neon.tech/)에서 새 프로젝트 생성
2. 데이터베이스 연결 문자열 복사

### 2. 환경 변수 설정

`.env.local` 파일을 생성하고 데이터베이스 연결 문자열을 추가하세요:

```bash
DATABASE_URL=postgresql://user:password@host.neon.tech/dbname?sslmode=require
```

### 3. 데이터베이스 마이그레이션

스키마를 데이터베이스에 적용합니다:

```bash
npm run db:push
```

### 4. Drizzle Studio (선택사항)

데이터베이스를 GUI로 관리하려면:

```bash
npm run db:studio
```

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
# my-music-ranking
