import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  // The @fiducia/sync reconcile core ships as a wasm-pack `--target bundler`
  // module (ESM `.wasm` import + top-level await for instantiation). vite-plugin-wasm
  // bundles the `.wasm`; the es2022 target lets Vite emit the top-level await
  // natively (no TLA transform needed — modern Chrome supports it).
  plugins: [wasm()],
  build: {
    target: "es2022",
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
