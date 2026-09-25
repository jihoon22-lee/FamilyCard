'use client';
import { useState } from 'react';
import type { Tier } from '@/lib/benefit/engine';
export function TierFields({ initial }: { initial: Tier[] }) {
  const [tiers, setTiers] = useState(
    initial.length ? initial : [{ threshold: 0, benefitDesc: '', monthlyCap: 0 }],
  );
  return (
    <fieldset className="flex flex-col gap-3">
      <legend>실적 구간</legend>
      {tiers.map((tier, index) => (
        <div key={index} className="grid gap-2 rounded border p-3 sm:grid-cols-3">
          <label>
            기준 금액 (원)
            <input
              name="threshold"
              type="number"
              min={0}
              step={1}
              max={2147483647}
              value={tier.threshold}
              onChange={(e) =>
                setTiers(
                  tiers.map((t, i) =>
                    i === index ? { ...t, threshold: Number(e.target.value) } : t,
                  ),
                )
              }
              required
              className="w-full rounded border p-2"
            />
          </label>
          <label>
            혜택 설명
            <input
              name="benefitDesc"
              value={tier.benefitDesc}
              maxLength={300}
              onChange={(e) =>
                setTiers(
                  tiers.map((t, i) => (i === index ? { ...t, benefitDesc: e.target.value } : t)),
                )
              }
              className="w-full rounded border p-2"
            />
          </label>
          <label>
            월 혜택 한도 (원)
            <input
              name="monthlyCap"
              type="number"
              min={0}
              step={1}
              max={2147483647}
              value={tier.monthlyCap}
              onChange={(e) =>
                setTiers(
                  tiers.map((t, i) =>
                    i === index ? { ...t, monthlyCap: Number(e.target.value) } : t,
                  ),
                )
              }
              required
              className="w-full rounded border p-2"
            />
          </label>
          <button
            type="button"
            disabled={tiers.length === 1}
            onClick={() => setTiers(tiers.filter((_, i) => i !== index))}
            className="rounded border p-2"
          >
            구간 삭제
          </button>
        </div>
      ))}
      <div className="flex gap-3">
        <button
          type="button"
          disabled={tiers.length >= 20}
          onClick={() =>
            setTiers([
              ...tiers,
              {
                threshold: (tiers.at(-1)?.threshold ?? 0) + 100000,
                benefitDesc: '',
                monthlyCap: 0,
              },
            ])
          }
          className="rounded border p-2"
        >
          구간 추가
        </button>
        <button
          type="button"
          onClick={() =>
            setTiers(
              [300000, 700000, 1000000].map((threshold) => ({
                threshold,
                benefitDesc: '약관에 맞게 수정',
                monthlyCap: 0,
              })),
            )
          }
          className="rounded border p-2"
        >
          30/70/100만 원 입력 예시
        </button>
      </div>
      <p className="text-xs">
        입력 예시는 특정 카드의 약관이 아닙니다. 실제 조건에 맞게 수정해주세요.
      </p>
    </fieldset>
  );
}
