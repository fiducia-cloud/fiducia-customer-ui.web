import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: "src/main.ts",
      output: {
        assetFileNames: "assets/customer.[ext]",
        chunkFileNames: "assets/customer-[name].js",
        entryFileNames: "assets/customer.js"
      }
    }
  }
});
