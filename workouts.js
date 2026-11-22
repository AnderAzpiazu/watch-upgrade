(function () {
  "use strict";
  const views = new WeakMap();
  const shortDate = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric" });
  const numbers = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });
  const types = {
    Walking: "Caminata", Running: "Carrera", Hiking: "Senderismo", Cycling: "Ciclismo",
    Swimming: "Natación", Elliptical: "Elíptica", Rowing: "Remo", Yoga: "Yoga",
    TraditionalStrengthTraining: "Fuerza", FunctionalStrengthTraining: "Fuerza funcional",
    HighIntensityIntervalTraining: "Intervalos de alta intensidad", Dance: "Baile",
    Other: "Entrenamiento"
  };

  function sessionLabel(session) {
    const key = (session.type || "").replace(/^HKWorkoutActivityType/, "");
    const name = Object.hasOwn(types, key) ? types[key] : key.replace(/([a-z])([A-Z])/g, "$1 $2") || "Entrenamiento";
    return name + " · " + shortDate.format(new Date(session.day + "T12:00:00")) + " · " + session.time;
  }

  function demo(days) {
    return Object.entries(days).filter(([, day]) => day.workouts > 0).map(([day, summary], i) => {
      const walking = i % 3 !== 1;
      const time = walking ? "18:10" : "08:30";
      const start = new Date(day + "T" + time).getTime();
      const durationMinutes = summary.workoutMinutes;
      const end = start + durationMinutes * 60000;
      const distanceKm = durationMinutes / (walking ? 10 + i % 4 : 5.25 + (i % 4) / 4);
      const pulse = [];
      for (let t = 0; t <= durationMinutes; t++) {
        const value = Math.round(78 + (walking ? 27 : 65) * Math.min(1, t / 6) +
          6 * Math.sin(t * 0.41 + i * 0.75) + 2 * Math.cos(t * 1.53));
        pulse.push({ at: start + t * 60000, value });
      }
      return {
        day, type: "HKWorkoutActivityType" + (walking ? "Walking" : "Running"), time, start, end,
        durationMinutes, distanceKm, paceMinPerKm: durationMinutes / distanceKm, pulse,
        averageHeartRate: pulse.reduce((sum, point) => sum + point.value, 0) / pulse.length,
        maxHeartRate: Math.max(...pulse.map(point => point.value))
      };
    });
  }

  function el(name, text, css) {
    const node = document.createElement(name);
    if (text !== undefined) node.textContent = text;
    if (css) node.className = css;
    return node;
  }

  function mins(value) {
    const total = Math.round(value * 60);
    const minutes = Math.floor(total / 60);
    return minutes + ":" + String(total % 60).padStart(2, "0");
  }

  function chart(canvas, sessions) {
    const width = Math.floor(canvas.getBoundingClientRect().width);
    if (!width) return;
    const height = 165, ratio = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    const left = 40, right = width - 18, top = 15, bottom = height - 28;
    let lo = Infinity, hi = -Infinity, minutes = 1;
    const series = sessions.map(session => {
      const readings = session.pulse || [];
      minutes = Math.max(minutes, (session.end - session.start) / 60000);
      return readings.map(point => {
        lo = Math.min(lo, point.value);
        hi = Math.max(hi, point.value);
        return [(point.at - session.start) / 60000, point.value];
      });
    });
    if (!Number.isFinite(lo)) return;
    lo = Math.max(0, Math.floor((lo - 4) / 10) * 10);
    hi = Math.ceil((hi + 4) / 10) * 10;
    ctx.font = "12px system-ui";
    for (let i = 0; i <= 2; i++) {
      const y = bottom - i * (bottom - top) / 2;
      ctx.fillStyle = "#b9bdbf";
      ctx.fillText(String(Math.round(lo + i * (hi - lo) / 2)), 4, y + 4);
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y);
      ctx.strokeStyle = "#363b3e"; ctx.stroke();
    }
    ctx.textAlign = "center";
    for (let i = 0; i <= 2; i++) {
      const x = left + i * (right - left) / 2;
      ctx.fillText(numbers.format(Math.round(minutes * i / 2)), x, height - 5);
    }
    series.forEach((points, index) => {
      ctx.strokeStyle = ctx.fillStyle = index ? "#b1a0e5" : "#ff7955";
      ctx.lineWidth = 2;
      ctx.setLineDash(index ? [6, 3] : []);
      let lastMinute = -Infinity;
      ctx.beginPath();
      for (const [minute, bpm] of points) {
        const x = left + (right - left) * minute / minutes, y = bottom - (bottom - top) * (bpm - lo) / (hi - lo);
        if (minute - lastMinute > 5) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
        lastMinute = minute;
      }
      ctx.stroke();
    });
  }

  function render(element, summary, selected) {
    const old = views.get(element);
    if (old?.summary === summary && old.selected === selected) return;
    old?.observer?.disconnect();
    element.replaceChildren();
    element.classList.add("workouts-panel");
    const title = el("h2", "Entrenamientos");
    element.append(title);
    const state = { summary, selected };
    views.set(element, state);
    const sessions = [...(summary.workouts ?? [])].sort((a, b) => b.start - a.start);
    if (!sessions.length) {
      const previousImport = !Array.isArray(summary.workouts) && Object.values(summary.days ?? {}).some(d => d.workouts > 0);
      element.append(el("p", previousImport ? "Vuelve a importar el XML para ver el detalle de tus sesiones." :
        "Todavía no hay sesiones en estos datos.", "workout-hint"));
      return;
    }

    const controls = el("div", undefined, "workout-selectors");
    const makeSelect = (label, optional) => {
      const field = el("label", label);
      const select = el("select");
      if (optional) select.add(new Option("Sin comparar", ""));
      sessions.forEach((session, i) => select.add(new Option(sessionLabel(session), String(i))));
      field.append(select);
      controls.append(field);
      return select;
    };
    const first = makeSelect("Sesión", false), second = makeSelect("Comparar con", true);
    const dateIndex = sessions.findIndex(session => session.day <= selected);
    first.value = String(Math.max(0, dateIndex));
    second.disabled = sessions.length < 2;
    const detail = el("div", undefined, "workout-detail");
    element.append(controls, detail);

    function update() {
      state.observer?.disconnect();
      detail.replaceChildren();
      if (first.value === second.value) second.value = "";
      for (const option of second.options) option.disabled = option.value === first.value;
      const rows = [sessions[Number(first.value)]];
      if (second.value !== "") rows.push(sessions[Number(second.value)]);
      const labels = rows.length === 2 ? ["Sesión", "Comparación"] : ["Sesión"];
      const table = el("table", undefined, "workout-table");
      const heading = table.createTHead().insertRow();
      for (const text of ["Medición", ...labels]) {
        const th = el("th", text); th.scope = "col"; heading.append(th);
      }
      const body = table.createTBody();
      const measures = [
        ["Duración", "durationMinutes", v => numbers.format(v) + " min"],
        ["Distancia", "distanceKm", v => numbers.format(v) + " km"],
        ["Ritmo medio", "paceMinPerKm", v => mins(v) + " min/km"],
        ["Pulso medio", "averageHeartRate", v => Math.round(v) + " lpm"],
        ["Pulso máximo", "maxHeartRate", v => Math.round(v) + " lpm"]
      ];
      for (const [name, key, format] of measures) {
        const tr = body.insertRow();
        const th = el("th", name); th.scope = "row"; tr.append(th);
        for (const row of rows) tr.insertCell().textContent = Number.isFinite(row[key]) ? format(row[key]) : "Sin dato";
      }
      detail.append(table, el("h3", "Pulso durante la sesión"));
      if (rows.some(row => row.pulse?.length)) {
        const legend = el("div", undefined, "workout-legend");
        rows.forEach((row, i) => {
          const label = row.pulse?.length ? labels[i] : labels[i] + " · sin muestras";
          legend.append(el("span", label, i ? "workout-line-second" : "workout-line-first"));
        });
        const canvas = el("canvas");
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", "Pulso medio por minuto desde el inicio de cada sesión en latidos por minuto");
        detail.append(legend, canvas, el("small", "Tiempo transcurrido (min) · Pulso (lpm)", "workout-hint"));
        chart(canvas, rows);
        state.observer = new ResizeObserver(() => chart(canvas, rows));
        state.observer.observe(canvas);
      } else {
        detail.append(el("p", "Sin muestras de pulso con hora durante estas sesiones.", "workout-hint"));
      }
    }
    first.addEventListener("change", update);
    second.addEventListener("change", update);
    update();
  }
  window.WatchWorkouts = Object.freeze({ render, demo });
})();
