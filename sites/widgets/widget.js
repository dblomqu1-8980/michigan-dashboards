/**
 * 906 Dashboard widget loader.
 *
 * Usage on a client's page:
 *
 *   <div data-906-widget="aurora" data-client="northwoods-inn"></div>
 *   <script async src="https://widgets.906dashboard.com/widget.js"></script>
 *
 * All this does is turn that div into a correctly-sized iframe and keep its
 * height synced. Rendering happens inside the frame, on our origin, so the
 * client's CSS cannot reach our markup and our JS cannot throw inside their
 * page. That isolation is the entire reason for the iframe.
 *
 * Safe to load twice — a second copy exits immediately, and each placeholder
 * is only ever mounted once.
 */
(function () {
  "use strict";

  if (window.__dash906WidgetLoader) return;
  window.__dash906WidgetLoader = true;

  var ORIGIN = (function () {
    // Resolve our own origin from the script tag, so a staging deploy loads
    // its own widget page instead of reaching back to production.
    var self = document.currentScript;
    if (self && self.src) {
      try { return new URL(self.src).origin; } catch (e) { /* fall through */ }
    }
    return "https://widgets.906dashboard.com";
  })();

  var WIDGETS = { aurora: "aurora.html" };

  // Pre-resize guesses only; the frame posts its real height on load.
  // The strip is two lines now, so 96 caused a visible jump on slow loads.
  var DEFAULT_HEIGHT = { card: 430, strip: 132, panel: 300 };

  // A frame that is refused by frame-ancestors never runs our code, so the
  // widget cannot report its own failure — the browser paints "refused to
  // connect" and we hear nothing. The height handshake is the signal: if a
  // frame has not reported in by now, it never started.
  var LOAD_TIMEOUT_MS = 8000;

  var seq = 0;
  var frames = Object.create(null);
  var reported = Object.create(null);

  function mount(node) {
    if (node.getAttribute("data-906-mounted") === "1") return;
    node.setAttribute("data-906-mounted", "1");

    var kind = node.getAttribute("data-906-widget") || "aurora";
    var page = WIDGETS[kind];
    if (!page) return;

    var size = node.getAttribute("data-size") || "";
    var fid = "w" + (++seq);

    var params = new URLSearchParams();
    params.set("fid", fid);
    ["client", "spot", "region", "size"].forEach(function (k) {
      var v = node.getAttribute("data-" + k);
      if (v) params.set(k, v);
    });

    var frame = document.createElement("iframe");
    frame.src = ORIGIN + "/" + page + "?" + params.toString();
    frame.title = "Tonight's aurora forecast — 906 Dashboard";
    frame.loading = "lazy";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.setAttribute("scrolling", "no");
    frame.setAttribute("allowtransparency", "true");
    frame.style.cssText =
      "width:100%;border:0;display:block;overflow:hidden;" +
      "height:" + (DEFAULT_HEIGHT[size] || DEFAULT_HEIGHT.card) + "px;" +
      "max-width:" + (size === "card" ? "360px" : "100%") + ";";

    frames[fid] = frame;
    node.appendChild(frame);

    setTimeout(function () {
      if (reported[fid]) return;
      // Two audiences, two messages. A visitor gets something calm and
      // non-technical; whoever is installing it gets the actual cause in the
      // console, because they are the only one who can fix it.
      frame.style.display = "none";
      var note = document.createElement("div");
      note.setAttribute("role", "status");
      note.style.cssText =
        "font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;" +
        "color:#6b7280;padding:12px 14px;border:1px solid #d7dbe0;border-radius:8px;background:#f7f8f9;";
      note.textContent = "Live aurora conditions are unavailable right now.";
      node.appendChild(note);

      console.error(
        "[906 widget] The widget frame never loaded.\n" +
        "Most likely this page's address is not on the widget's allowlist.\n" +
        "  This page: " + location.origin + "\n" +
        "  Widget:    " + ORIGIN + "\n" +
        "Note that frame-ancestors applies to EVERY frame in the chain, not just\n" +
        "the immediate parent — a CMS preview or staging host that wraps this page\n" +
        "has to be on the allowlist too. Send the address above to 906dashboard.com\n" +
        "and it will be added."
      );
    }, LOAD_TIMEOUT_MS);
  }

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.type !== "906widget:height") return;

    // Only accept a height from a frame this loader created, and only from
    // our own origin. Without both checks any page on the internet could
    // resize the client's embed by posting a message.
    if (e.origin !== ORIGIN) return;

    var frame = d.id && frames[d.id];
    if (!frame) {
      for (var k in frames) {
        if (frames[k].contentWindow === e.source) { frame = frames[k]; break; }
      }
    }
    if (!frame || frame.contentWindow !== e.source) return;

    var h = Number(d.height);
    if (!isFinite(h) || h < 40 || h > 2000) return;
    for (var id in frames) if (frames[id] === frame) reported[id] = true;
    frame.style.height = Math.ceil(h) + "px";
  });

  function scan() {
    var nodes = document.querySelectorAll("[data-906-widget]");
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scan);
  } else {
    scan();
  }

  // Re-scan for placeholders added later by a page builder or a SPA route
  // change. Squarespace and Wix both inject blocks after DOMContentLoaded.
  if (window.MutationObserver) {
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
