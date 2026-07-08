import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  // The @fiducia/sync reconcile core ships as a wasm-pack `--target bundler`
  // module (ESM `.wasm` import + top-level await for instantiation), which Vite
  // needs these two plugins to bundle.
  plugins: [wasm(), topLevelAwait()],
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
