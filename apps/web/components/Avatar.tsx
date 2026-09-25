"use client";

import { useState } from "react";
import { AVATARS } from "@/lib/dolive";

// PNGtuber 아바타: 말하면 talk.png(입 벌림), 음소거면 어둡게 + 뱃지. 흔들림 효과는 넣지 않는다.
// 그림 파일이 없으면 임시 동그라미 얼굴을 그린다.
export function Avatar({
  id,
  talking = false,
  muted = false,
  className = "",
}: {
  id: string;
  talking?: boolean;
  muted?: boolean;
  className?: string;
}) {
  const [brokenId, setBrokenId] = useState<string>();
  const hue = AVATARS.findIndex((a) => a.id === id) * 30;

  return (
    <div className={`relative aspect-square ${className}`}>
      <div className={`size-full ${muted ? "brightness-50" : ""}`}>
        {brokenId === id ? (
          <svg viewBox="0 0 100 100" className="size-full">
            <circle cx="50" cy="52" r="42" fill={`hsl(${hue} 65% 60%)`} />
            <circle cx="36" cy="45" r="5" fill="#1f1f1f" />
            <circle cx="64" cy="45" r="5" fill="#1f1f1f" />
            {talking ? (
              <ellipse cx="50" cy="68" rx="11" ry="9" fill="#1f1f1f" />
            ) : (
              <rect x="40" y="66" width="20" height="4" rx="2" fill="#1f1f1f" />
            )}
          </svg>
        ) : (
          <>
            {/* 두 장을 겹쳐 두고 보이기만 바꿔서 깜빡임을 없앤다 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/avatars/${id}/idle`}
              alt=""
              onError={() => setBrokenId(id)}
              // 화면 준비 전에 이미 실패한 경우는 onError가 안 불리므로 직접 확인
              ref={(el) => {
                if (el?.complete && !el.naturalWidth) setBrokenId(id);
              }}
              className={`absolute inset-0 size-full object-contain ${talking ? "invisible" : ""}`}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/avatars/${id}/talk`}
              alt=""
              className={`absolute inset-0 size-full object-contain ${talking ? "" : "invisible"}`}
            />
          </>
        )}
      </div>
      {muted && (
        <span
          className="absolute right-0 bottom-0 rounded-full bg-red-600 p-1 text-white"
          title="음소거"
          aria-label="음소거"
        >
          {/* 마이크에 빗금 */}
          <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16" />
          </svg>
        </span>
      )}
    </div>
  );
}
