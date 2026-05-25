// Human: Browser entry — mounts the React application into `#root` with StrictMode enabled.
// Agent: IMPORTS global CSS + App; CALLS createRoot(...).render; NO routing or API logic here.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
