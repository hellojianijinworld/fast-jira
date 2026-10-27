import { defineConfig } from "vite";

export default defineConfig({
  ssr: { noExternal: true },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": `http://127.0.0.1:${process.env.PORT ?? "4173"}` },
  },
  build: { outDir: "dist/client" },
});
