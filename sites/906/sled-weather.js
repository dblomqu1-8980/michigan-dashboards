// All five comparison points use Eastern time, including visitors viewing from elsewhere.
(() => {
  const dayInMichigan = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Detroit', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const dayMillis = 86400000;
  const inches = (value, factor) => Number.isFinite(value) && value >= 0
    ? (value * factor).toFixed(1) + ' in' : 'Unavailable';

  function showReportAge() {
    const today = Date.parse(dayInMichigan.format(new Date()));
    document.querySelectorAll('[data-age]').forEach(time => {
      const days = (today - Date.parse(time.dateTime)) / dayMillis;
      if (days >= 0) time.nextElementSibling.textContent = days === 0 ? ' · today' : ' · ' + days + (days === 1 ? ' day ago' : ' days ago');
    });
  }

  async function refresh(card) {
    const date = dayInMichigan.format(new Date());
    const tomorrow = new Date(Date.parse(date) + dayMillis).toISOString().slice(0, 10);
    const label = card.querySelector('[data-weather-time]');
    const depth = card.querySelector('[data-depth]');
    const forecast = card.querySelector('[data-forecast]');
    const params = new URLSearchParams({
      latitude: card.dataset.lat, longitude: card.dataset.lon, timezone: 'America/Detroit',
      current: 'snow_depth', daily: 'snowfall_sum', forecast_days: '2'
    });
    try {
      const response = await fetch('https://api.open-meteo.com/v1/forecast?' + params,
        {signal: AbortSignal.timeout(15000)});
      if (!response.ok) throw Error('Weather request failed');
      const wx = await response.json();
      const stamp = wx.current?.time || '';
      const forecastIndex = wx.daily?.time?.indexOf(tomorrow) ?? -1;
      depth.textContent = stamp.startsWith(date) && wx.current_units?.snow_depth === 'm'
        ? inches(wx.current.snow_depth, 1 / 0.0254) : 'Unavailable';
      forecast.textContent = wx.daily_units?.snowfall_sum === 'cm'
        ? inches(wx.daily?.snowfall_sum?.[forecastIndex], 1 / 2.54) : 'Unavailable';
      label.textContent = 'Forecast for ' + tomorrow + (stamp.startsWith(date) ? ' · Model time ' + stamp.replace('T',' ') + ' ET' : '');
    } catch {
      depth.textContent = forecast.textContent = 'Unavailable';
      label.textContent = 'Weather feed unavailable. Local reports are linked below.';
    }
  }

  function update() {
    if (document.hidden) return;
    showReportAge();
    document.querySelectorAll('article[data-lat]').forEach(refresh);
  }
  update();
  setInterval(update, 15 * 60 * 1000);
  document.addEventListener('visibilitychange', update);
})();
