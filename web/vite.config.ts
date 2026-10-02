import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, the API server (and /vendor: tree-sitter + astdiff + grammars) runs separately.
//   API=http://localhost:3100 npm run dev
const api = process.env.API || "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 800 },
  server: {
    port: Number(process.env.WEB_PORT || 5173),
    proxy: {
      "/api": { target: api, changeOrigin: true, ws: true },
      "/vendor": { target: api, changeOrigin: true },
    },
  },
});
