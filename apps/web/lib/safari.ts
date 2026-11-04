// 사파리인지: 다른 브라우저도 이름표에 Safari 를 적어서, 그 브라우저들의 이름을 뺀다 (아이폰 크롬 CriOS 포함). 시험: node tests/safari.cjs
export const isSafari = (ua: string) => /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR|OPiOS|SamsungBrowser|Whale|DaumApps|NAVER|KAKAOTALK|Android/i.test(ua);
