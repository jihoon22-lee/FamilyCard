import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Dockerfile의 `prod` 스테이지가 이 출력물을 그대로 복사해 실행합니다.
  // (dev 스테이지는 `next dev`를 쓰므로 영향받지 않습니다.)
  output: 'standalone',
};

export default nextConfig;
