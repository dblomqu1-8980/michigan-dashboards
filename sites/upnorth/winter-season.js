// Feature sled trips from preseason planning in November through March.
const michiganMonth = Number(new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Detroit', month: 'numeric'
}).format(new Date()));
if (michiganMonth >= 4 && michiganMonth <= 10) {
  document.querySelectorAll('[data-winter]').forEach(element => element.remove());
}
