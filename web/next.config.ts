import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Dockerfile의 `prod` 스테이지가 이 출력물을 그대로 복사해 실행합니다.
  // (dev 스테이지는 `next dev`를 쓰므로 영향받지 않습니다.)
  output: 'standalone',

  // 저장소가 WSL 의 Windows 드라이브 마운트(/mnt/e, 9p)에 있으면 inotify 가
  // 동작하지 않습니다. 실측: fs.watch 이벤트 0건 (같은 테스트가 ext4 에서는 1건).
  // 그대로 두면 `next dev` 의 HMR 이 에러 없이 조용히 멈춥니다 — 파일을 고쳐도
  // 브라우저가 반응하지 않는데 로그에는 아무것도 남지 않습니다.
  //
  // 폴링으로 전환해 우회합니다. Turbopack·webpack 양쪽 모두 이 값을 사용하며,
  // webpack 경로는 node_modules/.git/.next 를 감시에서 자동 제외합니다.
  // 저장소를 ext4(예: ~/projects)로 옮기면 이 설정은 지워도 됩니다.
  watchOptions: { pollIntervalMs: 1000 },
};

export default nextConfig;
