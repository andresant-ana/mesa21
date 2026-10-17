import { defineConfig } from "vite";

export default defineConfig({
  build: { rollupOptions: { input: ["index.html", "salas.html", "solo.html", "como-jogar.html", "conta.html", "classificatoria.html", "ranking.html", "carteira.html"] } },
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
