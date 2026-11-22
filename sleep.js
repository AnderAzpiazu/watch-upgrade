window.WatchSleep = (() => {
  const shortDay = new Intl.DateTimeFormat("es-ES", {weekday:"short", day:"numeric"});
  const timeLabel = minutes => {
    const clock = (Math.round(minutes) + 720) % 1440;
    return String(Math.floor(clock / 60)).padStart(2,"0") + ":" + String(clock % 60).padStart(2,"0");
  };
  function render(container, summary, selectedDate) {
    container.innerHTML = '<div class="kicker"><span class="dash"></span>DESCANSO</div><h2>Regularidad del sueño</h2><p class="feature-note">Inicio y fin del episodio principal en las últimas siete noches. El total incluye las siestas registradas.</p><div class="sleep-axis" aria-hidden="true"><span>12 h</span><span>18 h</span><span>00 h</span><span>06 h</span><span>12 h</span></div>';
    for (let ago=6; ago>=0; ago--) {
      const d = new Date(selectedDate + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate()-ago);
      const key = d.toISOString().slice(0,10);
      const day = summary.days[key] || {};
      const row = document.createElement("div");
      row.className = "sleep-row";
      const label = document.createElement("span");
      label.textContent = shortDay.format(new Date(key + "T12:00:00"));
      const track = document.createElement("div");
      track.className = "sleep-track";
      const details = document.createElement("span");
      details.className = "sleep-info";
      const timings = Number.isFinite(day.sleepStart) && Number.isFinite(day.sleepEnd);
      if (timings) {
        const bar = document.createElement("span");
        bar.style.left = Math.max(0,day.sleepStart)/14.4 + "%";
        bar.style.width = Math.max(0,(Math.min(1440,day.sleepEnd)-Math.max(0,day.sleepStart)))/14.4 + "%";
        track.append(bar);
        details.textContent = timeLabel(day.sleepStart) + "–" + timeLabel(day.sleepEnd);
      } else details.textContent = Number.isFinite(day.sleep) ? "Sin horario" : "Sin datos";
      if (Number.isFinite(day.sleep)) {
        const total = Math.round(day.sleep);
        const small = document.createElement("small");
        small.textContent = Math.floor(total/60)+" h "+total%60+" min en total";
        details.append(small);
      }
      row.append(label, track, details);
      container.append(row);
    }
  }
  return {render};
})();
