import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Request } from "express";
import busboy from "busboy";
import { AuthServiceError } from "../auth/auth-service.ts";
import {
  ensureFileStorageDirectories,
  maximumFileBytes,
  normalizeOriginalName,
  removeStoredPath,
  validateFileType,
} from "./file-storage.ts";
import type { UploadedFileContent } from "./files-service.ts";

export async function receiveMultipartUpload(
  request: Request,
  storageRoot: string,
  options: { allowedFields?: readonly string[] } = {},
): Promise<UploadedFileContent & { fields: Record<string, string> }> {
  if (!request.is("multipart/form-data")) {
    throw new AuthServiceError(400, "INVALID_MULTIPART", "La carga debe usar multipart/form-data.");
  }
  const contentLength = Number(request.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maximumFileBytes + 32_768) {
    throw new AuthServiceError(413, "FILE_TOO_LARGE", "El archivo supera el límite de 10 MiB.");
  }
  await ensureFileStorageDirectories(storageRoot);
  const tempPath = join(storageRoot, ".tmp", `${randomUUID()}.tmp`);

  return new Promise<UploadedFileContent & { fields: Record<string, string> }>((resolveUpload, rejectUpload) => {
    let settled = false;
    let seenFile = false;
    let failure: unknown;
    let uploadTask: Promise<void> = Promise.resolve();
    let content: UploadedFileContent | undefined;
    const fields: Record<string, string> = {};
    let parser: ReturnType<typeof busboy>;

    const fail = (error: unknown): void => {
      if (!failure) failure = error;
    };
    const finish = async (): Promise<void> => {
      if (settled) return;
      try {
        await uploadTask;
        if (failure) throw failure;
        if (!seenFile || !content) throw new AuthServiceError(400, "FILE_REQUIRED", "Selecciona un archivo para cargar.");
        settled = true;
        resolveUpload({ ...content, fields });
      } catch (error) {
        settled = true;
        await removeStoredPath(tempPath).catch(() => undefined);
        rejectUpload(error);
      }
    };

    try {
      parser = busboy({
        headers: request.headers,
        preservePath: true,
        limits: { fieldNameSize: 32, fieldSize: 512, fields: 1 + (options.allowedFields?.length ?? 0), fileSize: maximumFileBytes + 1, files: 1, parts: 2 + (options.allowedFields?.length ?? 0), headerPairs: 32 },
      });
    } catch {
      void removeStoredPath(tempPath);
      rejectUpload(new AuthServiceError(400, "INVALID_MULTIPART", "La carga multipart no es válida."));
      return;
    }

    parser.on("file", (fieldName, stream, info) => {
      if (seenFile || fieldName !== "file") {
        fail(new AuthServiceError(400, "INVALID_MULTIPART", "La solicitud debe contener un único campo de archivo llamado file."));
        stream.resume();
        return;
      }
      seenFile = true;
      let originalName: string;
      try {
        originalName = normalizeOriginalName(info.filename ?? "");
      } catch (error) {
        fail(error);
        stream.resume();
        return;
      }
      let byteCount = 0;
      let header = Buffer.alloc(0);
      const hash = createHash("sha256");
      stream.on("limit", () => fail(new AuthServiceError(413, "FILE_TOO_LARGE", "El archivo supera el límite de 10 MiB.")));
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          byteCount += chunk.length;
          if (header.length < 12) header = Buffer.concat([header, chunk.subarray(0, 12 - header.length)]);
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      uploadTask = pipeline(stream, meter, createWriteStream(tempPath, { flags: "wx", mode: 0o600 }))
        .then(() => {
          if (stream.truncated) {
            fail(new AuthServiceError(413, "FILE_TOO_LARGE", "El archivo supera el límite de 10 MiB."));
            return;
          }
          if (byteCount < 1 || byteCount > maximumFileBytes) {
            fail(new AuthServiceError(413, "FILE_TOO_LARGE", "El archivo supera el límite de 10 MiB."));
            return;
          }
          try {
            const detectedMime = validateFileType(originalName, info.mimeType, header);
            content = { tempPath, originalName, detectedMime, bytes: byteCount, sha256: hash.digest("hex") };
          } catch (error) {
            fail(error);
          }
        })
        .catch((error: unknown) => fail(error));
    });
    parser.on("field", (name, value) => {
      if (!options.allowedFields?.includes(name) || Object.hasOwn(fields, name)) {
        fail(new AuthServiceError(400, "INVALID_MULTIPART", "La carga contiene campos no permitidos o duplicados."));
        return;
      }
      fields[name] = value;
    });
    parser.on("partsLimit", () => fail(new AuthServiceError(400, "INVALID_MULTIPART", "La solicitud contiene más partes de las permitidas.")));
    parser.on("filesLimit", () => fail(new AuthServiceError(400, "INVALID_MULTIPART", "La solicitud debe contener un solo archivo.")));
    parser.on("fieldsLimit", () => fail(new AuthServiceError(400, "INVALID_MULTIPART", "No se permiten campos adicionales en la carga.")));
    parser.on("error", (_error) => fail(new AuthServiceError(400, "INVALID_MULTIPART", "La carga multipart no es válida.")));
    parser.on("close", () => { void finish(); });
    request.once("aborted", () => {
      fail(new AuthServiceError(400, "UPLOAD_ABORTED", "La carga fue interrumpida."));
      parser.destroy();
      void finish();
    });
    request.pipe(parser);
  });
}
