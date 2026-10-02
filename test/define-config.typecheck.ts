import { defineConfig } from "../src/config/schema.js";

const base = {
  app: { packageName: "com.example.app" },
  device: { avd: "Pixel_7_API_34" },
  frame: { background: ["#000000", "#ffffff"] as [string, string] },
};

defineConfig({
  ...base,
  publish: {
    serviceAccountKeyPath: "./secrets/key.json",
    listing: [
      "home.png",
      "profile-dark.png",
      "./marketing/a.png",
      "..\\marketing\\b.png",
    ],
  },
  screens: [
    { id: "home", flow: "home.yaml", background: ["#000000", "#111111"] },
    { id: "profile", flow: "profile.yaml" },
  ],
});

defineConfig({
  ...base,
  publish: {
    serviceAccountKeyPath: "./secrets/key.json",
    // @ts-expect-error "hom" is not a screen id
    listing: ["hom.png"],
  },
  screens: [{ id: "home", flow: "home.yaml" }],
});

defineConfig({
  ...base,
  publish: {
    serviceAccountKeyPath: "./secrets/key.json",
    // @ts-expect-error a bare name must be a framed .png
    listing: ["marketing/a.png"],
  },
  screens: [{ id: "home", flow: "home.yaml" }],
});

defineConfig({
  ...base,
  publish: { serviceAccountKeyPath: "./secrets/key.json" },
  screens: [{ id: "home", flow: "home.yaml" }],
});
