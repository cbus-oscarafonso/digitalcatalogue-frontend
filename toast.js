// toast.js — shared toast notification API.
// Usage:
//   toast("Saved");                              // success (default)
//   toast.success("Saved");                      // explicit success
//   toast.error("Failed to load");               // error
//   toast.info("Refreshing…");                   // info (neutral)
//   toast("Custom", { type: "error", duration: 6000 });
//
// Requires a `<div class="toast" id="toast" role="status" aria-live="polite"></div>`
// somewhere in the page (usually right before </body>).
// Styles live in styles.css (.toast, .toast--ok, .toast--err, .toast--info).
(function () {
  const DEFAULT_DURATION = 4000;
  let timer = null;

  function show(message, options) {
    const el = document.getElementById("toast");
    if (!el) {
      // Fail loudly in the console but don't throw — callers shouldn't break.
      console.warn("[toast] #toast element not found in DOM");
      return;
    }

    const opts = options || {};
    const type = opts.type || "ok";
    const duration = typeof opts.duration === "number" ? opts.duration : DEFAULT_DURATION;

    // Reset any ongoing animation / timer so repeated calls stack cleanly.
    clearTimeout(timer);
    el.classList.remove("show", "toast--ok", "toast--err", "toast--info");
    el.textContent = String(message == null ? "" : message);

    // Force reflow so the translateX centering recalculates with the new width
    // before the fade-in transition starts. Without this, the first toast
    // after a text change can appear visually offset for one frame.
    void el.offsetWidth;

    el.classList.add("show", "toast--" + type);

    timer = setTimeout(() => {
      el.classList.remove("show");
    }, duration);
  }

  function toast(message, options) {
    show(message, options);
  }
  toast.success = function (message, options) {
    show(message, Object.assign({}, options, { type: "ok" }));
  };
  toast.error = function (message, options) {
    show(message, Object.assign({}, options, { type: "err" }));
  };
  toast.info = function (message, options) {
    show(message, Object.assign({}, options, { type: "info" }));
  };

  window.toast = toast;
})();
