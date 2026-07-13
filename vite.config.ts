// Vite build config for the independently deployable customer portal.
import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  build: {
    target: "es2022",
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: "index.html",
      output: {
        assetFileNames: "assets/customer.[ext]",
        chunkFileNames: "assets/customer-[name].js",
        entryFileNames: "assets/customer.js"
      }
    }
  }
});
