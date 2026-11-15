import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/game/",
  plugins: [react()],
  server: {
    proxy: {
      "/game/api": "http://127.0.0.1:3020",
    },
  },
});
