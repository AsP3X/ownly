import path from "path";
import { cpSync, existsSync } from "fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Human: Ship pdf.js worker as a root-level .js file so nginx serves it with a known MIME type.
// Agent: COPIES pdf.worker.min.mjs -> public/dist pdf.worker.min.js; AVOIDS hashed .mjs asset MIME issues.
function copyPdfWorkerPlugin(): Plugin {
  const workerSource = path.resolve(__dirname, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
  const workerPublic = path.resolve(__dirname, "public/pdf.worker.min.js");
  const workerDist = path.resolve(__dirname, "dist/pdf.worker.min.js");

  const copyWorker = (destination: string) => {
    if (!existsSync(workerSource)) {
      throw new Error("pdfjs-dist worker missing — run npm ci in frontend before building.");
    }
    cpSync(workerSource, destination);
  };

  return {
    name: "copy-pdf-worker",
    buildStart() {
      copyWorker(workerPublic);
    },
    closeBundle() {
      copyWorker(workerDist);
    },
  };
}

/** Human: Keep heavy media/pdf chunks off the app shell preload list. */
function isDeferredMediaChunk(dep: string): boolean {
  return (
    dep.includes("/pdf-") ||
    dep.includes("/hls-") ||
    dep.includes("pdf-rptWOpCb.css") ||
    dep.includes("PdfPreviewDialog") ||
    dep.includes("pdf-viewer")
  );
}

({
  plugins: [react(), tailwindcss(), copyPdfWorkerPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Human: Split heavy vendor libs into cacheable chunks alongside route lazy loading.
    // Agent: manualChunks groups react-pdf/pdfjs and hls.js away from the app shell.
    modulePreload: {
      resolveDependencies(_filename, deps) {
        return deps.filter((dep) => !isDeferredMediaChunk(dep));
      },
    },
    rolldownOptions: {
      output: {
        manualChunks(id) {
          // pdf split only via dynamic import()
          if (id.includes("node_modules/hls.js")) {
            return "hls";
          }
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/react-router") ||
            id.includes("node_modules/scheduler/")
          ) {
            return "vendor-react";
          }
          if (id.includes("node_modules/@base-ui/")) {
            return "vendor-ui";
          }
        },
      },
    },
  },
  server: {
    proxy: {
      "/api/v1": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
