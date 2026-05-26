// Human: Shared pdf.js worker setup for in-browser PDF rendering (view now, edit later).
// Agent: CONFIGURES pdfjs.GlobalWorkerOptions once; IMPORTED by PdfPreviewDialog before Document mounts.

import { pdfjs } from "react-pdf";

// Human: Point pdf.js at a stable root-level worker URL with a .js extension (nginx-safe MIME).
// Agent: READS /pdf.worker.min.js copied by Vite plugin; REQUIRED before react-pdf Document mounts.
pdfjs.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.js`;

export { pdfjs };
