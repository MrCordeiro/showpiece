import { defineConfig } from "vitrine";

export default defineConfig({
  app: {
    packageName: "com.example.myapp",
    // apkPath: "./builds/app-release.apk", // optional; omit if already installed
  },
  device: {
    avd: "Pixel_7_API_34",
    locale: "en-US",
    // This build is a Metro-backed dev build (expo run:android / dev client):
    // capture forwards the Metro port and checks Metro is running first. Keep
    // `npx expo start` running. Set devServer:false for a standalone
    // release/preview APK that embeds the JS bundle.
    devServer: true,
    metroPort: 8081,
  },
  frame: {
    template: "gradient",
    background: ["#1a1a2e", "#16213e"],
    textColor: "#ffffff",
    font: "Inter",
  },
  publish: {
    serviceAccountKeyPath: "./.envs/play-service-account.json",
    track: "listing",
  },
  // System UI mode the device is put into before capturing. "dark" also saves
  // every screenshot with a `-dark` suffix. Override per run with
  // `npx vitrine capture --appearance dark`. Your app must follow the system
  // appearance for this to change anything.
  appearance: "light",
  screens: [
    {
      id: "home",
      flow: ".vitrine/flows/home.yaml",
      caption: "Track everything in one place",
    },
    {
      id: "profile",
      flow: ".vitrine/flows/profile.yaml",
      caption: "Your data, your way",
    },
    {
      id: "settings",
      flow: ".vitrine/flows/settings.yaml",
      caption: "Make it yours",
    },
  ],
});
