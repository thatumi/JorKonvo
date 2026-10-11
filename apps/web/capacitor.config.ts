import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.szabotar.jorkonvo",
  appName: "JorKonvo",
  webDir: "dist",
  server: {
    // Only relevant for `cap run` live-reload during development; production
    // builds bundle dist/ directly and ignore this.
    androidScheme: "https",
  },
  plugins: {
    PushNotifications: {
      // App in the foreground: no system banner - NotificationManager already
      // plays the in-app sound, and the open room shouldn't notify at all.
      // (iOS only; on Android JorKonvoMessagingService skips it itself.)
      presentationOptions: [],
    },
  },
};

export default config;
