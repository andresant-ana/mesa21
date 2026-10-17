import { defineConfig } from "vite";

export default defineConfig({
  build: { rollupOptions: { input: ["index.html", "salas.html", "conta.html"] } },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        ws: true
      }
    }
  }
});
