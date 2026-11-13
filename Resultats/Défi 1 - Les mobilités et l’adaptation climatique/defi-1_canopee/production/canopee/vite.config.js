import { defineConfig } from "vite";

function serveDataviz(server) {
  server.middlewares.use((req, res, next) => {
    const [pathname, query] = req.url.split("?", 2);
    if (pathname === "/dataviz/") {
      res.writeHead(308, { Location: query ? `/dataviz?${query}` : "/dataviz" });
      res.end();
      return;
    }
    if (pathname === "/dataviz") req.url = query ? `/recit.html?${query}` : "/recit.html";
    next();
  });
}

export default defineConfig({
  base: "./",
  build: {
    target: "esnext",
    rollupOptions: { input: { carte: "index.html", dataviz: "recit.html" } },
  },
  plugins: [{
    name: "dataviz-path",
    configureServer: serveDataviz,
    configurePreviewServer: serveDataviz,
  }],
  optimizeDeps: {
    // Le worker MapLibre est importé comme ressource dans main.js.
    exclude: ["maplibre-gl"],
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts: [".trycloudflare.com"],
  },
  preview: { host: "0.0.0.0", port: 5173, strictPort: true },
});
