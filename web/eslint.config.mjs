import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';
import eslintConfigPrettier from 'eslint-config-prettier';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  eslintConfigPrettier,
  {
    // next-env.d.ts는 `next dev`/`next build`가 자동 생성·갱신하는 파일이라
    // 린트 대상에서 뺍니다 (버전에 따라 typed-routes triple-slash 참조가
    // 들어가 triple-slash-reference 규칙과 충돌합니다).
    ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'src/generated/**', 'next-env.d.ts'],
  },
];

export default eslintConfig;
