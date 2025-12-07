import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "",
  server: {
    host: true,
    port: 5173,
    allowedHosts: [".ngrok-free.app"],
  },
  preview: {
    host: true,
    port: 5173, // align with dev + ngrok target
    allowedHosts: [".ngrok-free.app"],
  },
});
