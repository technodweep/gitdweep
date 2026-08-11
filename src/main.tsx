import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

const rootEl = document.getElementById("root");

if (!rootEl) {
  document.body.innerHTML =
    "<pre style='padding:1rem;color:#f07178'>#root element missing</pre>";
} else {
  try {
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  } catch (err) {
    rootEl.innerHTML = `<pre style="padding:1rem;color:#f07178;white-space:pre-wrap">Failed to start UI:\n${String(err)}</pre>`;
    console.error(err);
  }
}

// Surface uncaught errors in the window (helps debug blank screens)
window.addEventListener("error", (e) => {
  console.error("window.error", e.error || e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("unhandledrejection", e.reason);
});
