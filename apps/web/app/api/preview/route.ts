import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { dormsCheck } from "@/lib/server";

// 채팅에 올라온 링크의 미리보기(제목·설명·그림 주소)를 서버가 대신 읽어 온다. (브라우저는 다른 사이트를 직접 못 읽어서)
// 집 안 기기(공유기 관리 화면, 이 PC의 통화 서버 등)를 두드리는 데 쓰이지 않게 바깥 인터넷 주소만 읽는다.
type Preview = { title: string; description?: string; image?: string; site: string };

// ponytail: 서버를 켜 둔 동안만 기억, 끄면 비워진다. 500개가 넘으면 통째로 비운다
const cache = new Map<string, Preview | null>();

export async function GET(req: Request) {
  const { deny } = await dormsCheck(req); // 도름스 회원만 (아무나 이 서버로 다른 사이트를 읽게 두지 않는다)
  if (deny) return deny;
  const url = new URL(req.url).searchParams.get("url") ?? "";
  if (!cache.has(url)) {
    if (cache.size > 500) cache.clear();
    cache.set(url, await load(url).catch(() => null));
  }
  return Response.json(cache.get(url));
}

function isPublicIp(ip: string) {
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const l = ip.toLowerCase();
  return !(l === "::" || l === "::1" || /^f[cd]/.test(l) || /^fe[89ab]/.test(l));
}

// ponytail: 주소를 확인한 뒤 실제로 읽을 때 다시 찾아보므로, 그 사이에 주소를 바꾸는 속임수까지는 못 막는다
async function checked(raw: string) {
  const u = new URL(raw);
  if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password) return null;
  const addrs = await lookup(u.hostname, { all: true });
  return addrs.length && addrs.every((a) => isPublicIp(a.address)) ? u : null;
}

async function load(raw: string): Promise<Preview | null> {
  let next = raw;
  // 다른 주소로 넘기면(redirect) 그 주소도 다시 확인한다. 4번까지만
  for (let i = 0; i < 4; i++) {
    const u = await checked(next);
    if (!u) return null;
    const r = await fetch(u, {
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; DOLIVE link preview)", accept: "text/html" },
    });
    const loc = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && loc) {
      next = new URL(loc, u).href;
      continue;
    }
    const type = r.headers.get("content-type") ?? "";
    if (!r.ok || !type.includes("text/html")) return null;
    return parse(await readStart(r, /charset=([\w-]+)/i.exec(type)?.[1]), u);
  }
  return null;
}

// 페이지 앞의 <head> 부분만 읽는다 (미리보기 정보가 거기 있다). 유튜브는 head가 700KB쯤이라 2MB까지
async function readStart(r: Response, charset = "utf-8") {
  const reader = r.body!.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  while (n < 2 * 1024 * 1024) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    n += value.length;
    if (Buffer.from(value).includes("</head>")) break;
  }
  reader.cancel().catch(() => {});
  const bytes = Buffer.concat(parts);
  try {
    return new TextDecoder(charset).decode(bytes); // 옛 한국 사이트는 euc-kr
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

function parse(html: string, page: URL): Preview | null {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  const attr = (tag: string, name: string) =>
    new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag)?.slice(1).find((v) => v !== undefined);
  const meta = (...keys: string[]) => {
    for (const key of keys)
      for (const tag of metas) {
        const k = (attr(tag, "property") ?? attr(tag, "name"))?.toLowerCase();
        if (k === key) return decode(attr(tag, "content") ?? "").trim() || undefined;
      }
  };

  const title = meta("og:title", "twitter:title") ?? decode(/<title[^>]*>([^<]*)/i.exec(html)?.[1] ?? "").trim();
  if (!title) return null;
  let image = meta("og:image", "og:image:url", "twitter:image");
  try {
    image = image ? new URL(image, page).href : undefined;
    if (image && !/^https?:/.test(image)) image = undefined;
  } catch {
    image = undefined;
  }
  return {
    title: title.slice(0, 200),
    description: meta("og:description", "twitter:description", "description")?.slice(0, 300),
    image,
    site: meta("og:site_name") ?? page.hostname.replace(/^www\./, ""),
  };
}

function decode(s: string) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}
