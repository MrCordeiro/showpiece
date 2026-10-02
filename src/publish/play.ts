import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { androidpublisher, auth } from "@googleapis/androidpublisher";
import { VitrineError } from "../util/errors.js";

export interface ServiceAccountKey {
  keyPath: string;
  clientEmail: string;
}

export type PlayStep =
  | "insert"
  | "listing"
  | "list"
  | "deleteall"
  | "upload"
  | "validate"
  | "commit"
  | "delete";

export interface PlayClient {
  insertEdit(): Promise<string>;
  hasListing(editId: string, language: string): Promise<boolean>;
  countScreenshots(editId: string, language: string): Promise<number>;
  deleteAllScreenshots(editId: string, language: string): Promise<void>;
  uploadScreenshot(
    editId: string,
    language: string,
    path: string,
  ): Promise<void>;
  validateEdit(editId: string): Promise<void>;
  commitEdit(editId: string): Promise<void>;
  deleteEdit(editId: string): Promise<void>;
}

const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const IMAGE_TYPE = "phoneScreenshots";

export async function readServiceAccountKey(
  keyPath: string,
): Promise<ServiceAccountKey> {
  let text: string;
  try {
    text = await readFile(keyPath, "utf8");
  } catch (error) {
    throw new VitrineError(
      "E_PUBLISH_KEY_NOT_FOUND",
      `Service account key not found: ${keyPath}. Create the key as README "Publish setup" describes, or fix publish.serviceAccountKeyPath.`,
      { cause: error },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const key = parsed as
    | { type?: unknown; client_email?: unknown; private_key?: unknown }
    | undefined;
  if (
    !key ||
    key.type !== "service_account" ||
    typeof key.client_email !== "string" ||
    typeof key.private_key !== "string"
  ) {
    throw new VitrineError(
      "E_PUBLISH_KEY_INVALID",
      `${keyPath} is not a Google service account JSON key. It must contain "type": "service_account", "client_email" and "private_key".`,
    );
  }
  return { keyPath, clientEmail: key.client_email };
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as {
    status?: unknown;
    code?: unknown;
    response?: { status?: unknown };
  };
  for (const value of [
    candidate.status,
    candidate.response?.status,
    candidate.code,
  ]) {
    if (typeof value === "number") return value;
  }
  return undefined;
}

export function toPublishError(
  error: unknown,
  step: PlayStep,
  key: ServiceAccountKey,
  packageName: string,
): VitrineError {
  if (error instanceof VitrineError) return error;
  const status = httpStatus(error);
  const message = error instanceof Error ? error.message : String(error);
  const options = { cause: error };

  if (
    status === 401 ||
    /invalid_grant|invalid_client|private key/i.test(message)
  ) {
    return new VitrineError(
      "E_PUBLISH_AUTH",
      `Google rejected the service account key ${key.keyPath}: ${message}. Somebody may have deleted the key, or the key is wrong. Create a new key as README "Publish setup" describes.`,
      options,
    );
  }
  if (status === 403) {
    return new VitrineError(
      "E_PUBLISH_PERMISSION",
      `The service account ${key.clientEmail} has no permission for ${packageName}: ${message}. In Play Console > Users and permissions, invite this account and grant "Manage store presence" for the app. A new permission can take a few minutes to start working.`,
      options,
    );
  }
  if (step === "insert" && status === 404) {
    return new VitrineError(
      "E_PUBLISH_APP_NOT_FOUND",
      `Play has no app ${packageName} that ${key.clientEmail} can open: ${message}. Check app.packageName in the config.`,
      options,
    );
  }
  // The in-review error text is not documented. This check is based on the
  // word "review", and Play's own message is always kept in the output.
  // The changesNotSentForReview message also contains "review", but it is
  // excluded because retrying cannot fix it.
  if (
    step === "commit" &&
    /review/i.test(message) &&
    !/changesNotSentForReview/i.test(message)
  ) {
    return new VitrineError(
      "E_PUBLISH_IN_REVIEW",
      `Play has changes in review for ${packageName}, so vitrine did not commit. Run "vitrine publish" again after Google approves them. Play said: ${message}`,
      options,
    );
  }
  return new VitrineError(
    "E_PUBLISH_API",
    `Play API error during ${step} (HTTP ${status ?? "unknown"}): ${message}`,
    options,
  );
}

function mimeTypeFor(path: string): string {
  const extension = extname(path).toLowerCase();
  return extension === ".jpg" || extension === ".jpeg"
    ? "image/jpeg"
    : "image/png";
}

export function createPlayClient(
  key: ServiceAccountKey,
  packageName: string,
): PlayClient {
  const api = androidpublisher({
    version: "v3",
    auth: new auth.GoogleAuth({ keyFile: key.keyPath, scopes: [SCOPE] }),
  });

  async function call<T>(
    step: PlayStep,
    request: () => Promise<T>,
  ): Promise<T> {
    try {
      return await request();
    } catch (error) {
      throw toPublishError(error, step, key, packageName);
    }
  }

  return {
    insertEdit: () =>
      call("insert", async () => {
        const response = await api.edits.insert({ packageName });
        if (!response.data.id)
          throw new Error("edits.insert returned no edit id");
        return response.data.id;
      }),
    hasListing: async (editId, language) => {
      try {
        await api.edits.listings.get({ packageName, editId, language });
        return true;
      } catch (error) {
        if (httpStatus(error) === 404) return false;
        throw toPublishError(error, "listing", key, packageName);
      }
    },
    countScreenshots: (editId, language) =>
      call("list", async () => {
        const response = await api.edits.images.list({
          packageName,
          editId,
          language,
          imageType: IMAGE_TYPE,
        });
        return response.data.images?.length ?? 0;
      }),
    deleteAllScreenshots: (editId, language) =>
      call("deleteall", async () => {
        await api.edits.images.deleteall({
          packageName,
          editId,
          language,
          imageType: IMAGE_TYPE,
        });
      }),
    uploadScreenshot: (editId, language, path) =>
      call("upload", async () => {
        await api.edits.images.upload({
          packageName,
          editId,
          language,
          imageType: IMAGE_TYPE,
          media: { mimeType: mimeTypeFor(path), body: createReadStream(path) },
        });
      }),
    validateEdit: (editId) =>
      call("validate", async () => {
        await api.edits.validate({ packageName, editId });
      }),
    commitEdit: (editId) =>
      call("commit", async () => {
        // The API default, CANCEL_IN_REVIEW_AND_SUBMIT, cancels changes that
        // are in review, such as a pending app release.
        await api.edits.commit({
          packageName,
          editId,
          changesInReviewBehavior: "ERROR_IF_IN_REVIEW",
        });
      }),
    deleteEdit: (editId) =>
      call("delete", async () => {
        await api.edits.delete({ packageName, editId });
      }),
  };
}
