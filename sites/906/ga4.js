(function () {
  if (window.__dashGa4Booted) return;
  window.__dashGa4Booted = true;
  var MEASUREMENT_ID = 'G-MP8ERM5MQC';
  window.dataLayer = window.dataLayer || [];
  function gtag(){ dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', MEASUREMENT_ID);
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
  document.head.appendChild(s);

  var SEASONAL = { aurora: 1, fall: 1, hunting: 1, trails: 1, waterfalls: 1, ski: 1 };
  document.addEventListener('click', function (event) {
    var anchor = event.target && event.target.closest && event.target.closest('a[href]');
    if (!anchor) return;
    var url;
    try { url = new URL(anchor.href, window.location.href); } catch (_) { return; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (url.hostname !== window.location.hostname) {
      gtag('event', 'outbound_click', { send_to: MEASUREMENT_ID, link_hostname: url.hostname });
      return;
    }
    var match = url.pathname.match(/\/([a-z0-9-]+)\.html$/i);
    var pageName = match ? match[1].toLowerCase() : '';
    if (SEASONAL[pageName]) {
      gtag('event', 'dashboard_page_interest', { send_to: MEASUREMENT_ID, page_name: pageName });
    }
  });
})();
