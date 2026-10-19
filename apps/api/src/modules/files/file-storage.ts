import { mkdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { AuthServiceError } from "../auth/auth-service.ts";

export const maximumFileBytes = 10 * 1024 * 1024;
export const orphanGracePeriodMs = 24 * 60 * 60 * 1_000;

const storageKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

export function resolveFileStorageRoot(configuredPath = process.env.FILE_STORAGE_PATH): string {
  const path = configuredPath?.trim() || ".data/files";
  const absolutePath = resolve(isAbsolute(path) ? path : resolve(workspaceRoot, path));
  const publicRoot = resolve(workspaceRoot, "apps/web/public");
  const relativeToPublic = relative(publicRoot, absolutePath);
  if (relativeToPublic === "" || (!isAbsolute(relativeToPublic) && relativeToPublic !== ".." && !relativeToPublic.startsWith(`..${sep}`))) {
    throw new Error("FILE_STORAGE_PATH debe estar fuera de apps/web/public.");
  }
  return absolutePath;
}

export function getStoredFilePath(root: string, storageKey: string): string {
  if (!storageKeyPattern.test(storageKey)) {
    throw new AuthServiceError(500, "FILE_STORAGE_KEY_INVALID", "No fue posible acceder al archivo.");
  }
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, storageKey.slice(0, 2), storageKey.slice(2, 4), storageKey);
  const relative = target.slice(absoluteRoot.length).replace(/^[\\/]+/u, "");
  if (!relative || relative.startsWith("..") || isAbsolute(relative)) {
    throw new AuthServiceError(500, "FILE_STORAGE_KEY_INVALID", "No fue posible acceder al archivo.");
  }
  return target;
}

export async function ensureFileStorageDirectories(root: string): Promise<void> {
  await mkdir(resolve(root, ".tmp"), { recursive: true, mode: 0o700 });
}

export async function removeStoredPath(path: string): Promise<void> {
  await rm(path, { force: true });
}

export function normalizeOriginalName(filename: string): string {
  const normalized = filename.normalize("NFKC").trim();
  if (
    normalized.length < 1 || normalized.length > 255 ||
    normalized.includes("/") || normalized.includes("\\") ||
    normalized === "." || normalized === ".." ||
    [...normalized].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  ) {
    throw new AuthServiceError(400, "INVALID_FILE_NAME", "El nombre del archivo no es válido.");
  }
  return normalized;
}

export function detectFileMime(header: Uint8Array): string | null {
  if (header.length >= 5 && Buffer.from(header.subarray(0, 5)).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    header.length >= 8 && header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47 &&
    header[4] === 0x0d && header[5] === 0x0a && header[6] === 0x1a && header[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    header.length >= 12 && Buffer.from(header.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(header.subarray(8, 12)).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function validateFileType(filename: string, declaredMime: string, header: Uint8Array): string {
  const extension = filename.split(".").pop()?.toLocaleLowerCase("en-US") ?? "";
  const detectedMime = detectFileMime(header);
  const allowed: Readonly<Record<string, string>> = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };
  const declared = declaredMime.split(";", 1)[0]?.trim().toLocaleLowerCase("en-US") ?? "";
  if (!detectedMime || allowed[extension] !== detectedMime || declared !== detectedMime) {
    throw new AuthServiceError(400, "UNSUPPORTED_FILE_TYPE", "El tipo real, la extensión y el MIME declarado deben coincidir con PDF, JPEG, PNG o WEBP.");
  }
  return detectedMime;
}
