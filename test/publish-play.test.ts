import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  edits: {
    insert: vi.fn(),
    validate: vi.fn(),
    commit: vi.fn(),
    delete: vi.fn(),
    listings: { get: vi.fn() },
    images: {
      list: vi.fn(),
      deleteall: vi.fn(),
      upload: vi.fn(),
    },
  },
}));

vi.mock("@googleapis/androidpublisher", () => ({
  androidpublisher: vi.fn(() => api),
  auth: { GoogleAuth: vi.fn() },
}));

const key = {
  keyPath: "/secrets/key.json",
  clientEmail: "vitrine@p.iam.gserviceaccount.com",
};
const pkg = "com.example.app";

function httpError(status: number, message = "Request failed"): Error {
  return Object.assign(new Error(message), { status });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readServiceAccountKey", () => {
  const dir = mkdtempSync(join(tmpdir(), "vitrine-key-"));

  it("returns the path and client email of a valid key", async () => {
    const { readServiceAccountKey } = await import("../src/publish/play.js");
    const path = join(dir, "good.json");
    writeFileSync(
      path,
      JSON.stringify({
        type: "service_account",
        client_email: key.clientEmail,
        private_key: "-----BEGIN PRIVATE KEY-----",
      }),
    );
    expect(await readServiceAccountKey(path)).toEqual({
      keyPath: path,
      clientEmail: key.clientEmail,
    });
  });

  it("throws E_PUBLISH_KEY_NOT_FOUND for a missing file", async () => {
    const { readServiceAccountKey } = await import("../src/publish/play.js");
    await expect(
      readServiceAccountKey(join(dir, "none.json")),
    ).rejects.toMatchObject({ code: "E_PUBLISH_KEY_NOT_FOUND" });
  });

  it.each([
    ["not JSON", "{oops"],
    ["not a service account", JSON.stringify({ type: "authorized_user" })],
  ])(
    "throws E_PUBLISH_KEY_INVALID for a file that is %s",
    async (_name, text) => {
      const { readServiceAccountKey } = await import("../src/publish/play.js");
      const path = join(dir, "bad.json");
      writeFileSync(path, text);
      await expect(readServiceAccountKey(path)).rejects.toMatchObject({
        code: "E_PUBLISH_KEY_INVALID",
      });
    },
  );
});

describe("createPlayClient", () => {
  it("authenticates with the key file and the androidpublisher scope", async () => {
    const { auth } = await import("@googleapis/androidpublisher");
    const { createPlayClient } = await import("../src/publish/play.js");
    createPlayClient(key, pkg);
    expect(auth.GoogleAuth).toHaveBeenCalledWith({
      keyFile: key.keyPath,
      scopes: ["https://www.googleapis.com/auth/androidpublisher"],
    });
  });

  it("commits with ERROR_IF_IN_REVIEW", async () => {
    const { createPlayClient } = await import("../src/publish/play.js");
    api.edits.commit.mockResolvedValue({ data: {} });
    await createPlayClient(key, pkg).commitEdit("edit-1");
    expect(api.edits.commit).toHaveBeenCalledWith({
      packageName: pkg,
      editId: "edit-1",
      changesInReviewBehavior: "ERROR_IF_IN_REVIEW",
    });
  });

  it.each([
    ["a.png", "image/png"],
    ["a.jpg", "image/jpeg"],
    ["a.JPEG", "image/jpeg"],
  ])(
    "uploads %s as a phone screenshot with type %s",
    async (file, mimeType) => {
      const { createPlayClient } = await import("../src/publish/play.js");
      const path = join(mkdtempSync(join(tmpdir(), "vitrine-up-")), file);
      writeFileSync(path, "x");
      api.edits.images.upload.mockResolvedValue({ data: {} });
      await createPlayClient(key, pkg).uploadScreenshot(
        "edit-1",
        "en-US",
        path,
      );
      expect(api.edits.images.upload).toHaveBeenCalledWith(
        expect.objectContaining({
          packageName: pkg,
          editId: "edit-1",
          language: "en-US",
          imageType: "phoneScreenshots",
          media: expect.objectContaining({ mimeType }),
        }),
      );
    },
  );

  it.each([
    ["2 for a listing with two screenshots", { images: [{}, {}] }, 2],
    ["0 when Play sends no images field", {}, 0],
  ])("counts %s", async (_case, data, expected) => {
    const { createPlayClient } = await import("../src/publish/play.js");
    api.edits.images.list.mockResolvedValue({ data });
    expect(
      await createPlayClient(key, pkg).countScreenshots("edit-1", "en-US"),
    ).toBe(expected);
  });

  it("reports no listing for a 404 and a listing for a success", async () => {
    const { createPlayClient } = await import("../src/publish/play.js");
    const client = createPlayClient(key, pkg);
    api.edits.listings.get.mockRejectedValueOnce(httpError(404));
    expect(await client.hasListing("edit-1", "xx-XX")).toBe(false);
    api.edits.listings.get.mockResolvedValueOnce({ data: {} });
    expect(await client.hasListing("edit-1", "en-US")).toBe(true);
  });
});

describe("toPublishError", () => {
  it.each([
    ["insert", httpError(401), "E_PUBLISH_AUTH"],
    [
      "insert",
      new Error("invalid_grant: Invalid JWT Signature."),
      "E_PUBLISH_AUTH",
    ],
    ["upload", httpError(403), "E_PUBLISH_PERMISSION"],
    ["insert", httpError(404), "E_PUBLISH_APP_NOT_FOUND"],
    [
      "commit",
      httpError(400, "The app has changes in review."),
      "E_PUBLISH_IN_REVIEW",
    ],
    ["validate", httpError(400, "Bad image"), "E_PUBLISH_API"],
    [
      "commit",
      httpError(
        400,
        "Changes cannot be sent for review automatically. Please set the query parameter changesNotSentForReview to true.",
      ),
      "E_PUBLISH_API",
    ],
  ] as const)("maps a %s failure to %s", async (step, error, code) => {
    const { toPublishError } = await import("../src/publish/play.js");
    expect(toPublishError(error, step, key, pkg).code).toBe(code);
  });

  it("names the service account in a permission error", async () => {
    const { toPublishError } = await import("../src/publish/play.js");
    const error = toPublishError(httpError(403), "insert", key, pkg);
    expect(error.message).toContain(key.clientEmail);
    expect(error.message).toContain("Manage store presence");
  });

  it("keeps Play's own message in the in-review error", async () => {
    const { toPublishError } = await import("../src/publish/play.js");
    const error = toPublishError(
      httpError(400, "The app has changes in review."),
      "commit",
      key,
      pkg,
    );
    expect(error.message).toContain("The app has changes in review.");
  });

  it("maps errors thrown by client methods", async () => {
    const { createPlayClient } = await import("../src/publish/play.js");
    api.edits.validate.mockRejectedValue(httpError(403));
    await expect(
      createPlayClient(key, pkg).validateEdit("edit-1"),
    ).rejects.toMatchObject({ code: "E_PUBLISH_PERMISSION" });
  });
});
