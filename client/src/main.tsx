import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Strip legacy hash routes (#/foo) carried over from the old hash router.
// Anyone arriving via an old bookmark / cached PWA shortcut to /#/missoula
// gets redirected to the clean path /missoula instead.
if (typeof window !== "undefined" && window.location.hash.startsWith("#/")) {
  const target = window.location.hash.slice(1) || "/";
  window.history.replaceState(null, "", target);
}

createRoot(document.getElementById("root")!).render(<App />);
