import path from "node:path";

// 서버 쪽에서만 쓰는 폴더 위치 (웹은 apps/web 에서 실행된다)
const ROOT = path.join(process.cwd(), "..", "..");
export const PROFILE_DIR = path.join(ROOT, "assets", "profile");
export const UPLOAD_DIR = path.join(ROOT, "server", "uploads");
