import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: "prompt",
    includeAssets: ["favicon.svg"],
    manifest: {
      name: "Cardroom — Play Together", short_name: "Cardroom", description: "Premium card games with friends or offline opponents.",
      theme_color: "#11120f", background_color: "#10110f", display: "standalone", start_url: "/",
      icons: [{ src: "/icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any maskable" }, { src: "/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any maskable" }],
    },
    workbox: { navigateFallback: "/index.html", globPatterns: ["**/*.{js,css,html,svg,woff2}"], runtimeCaching: [{ urlPattern: /^https?:\/\/localhost:4000\/api\//, handler: "NetworkOnly" }] },
  })],
  server: { port: 5173 },
});
