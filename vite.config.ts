import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
// import visualizer from "rollup-plugin-visualizer";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // build: {
  //   rollupOptions: {
  //     plugins: [visualizer()],
  //   },
  // },
});
