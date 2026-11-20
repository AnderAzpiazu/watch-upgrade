/* Apple Health XML is read in bounded chunks so a years-long export need not fit in memory. */
(function () {
  "use strict";

  const MINUTE = 60000;
  const DAY = 24 * 60 * MINUTE;
  const CHUNK_BYTES = 256 * 1024;
  const MAX_TAG_LENGTH = 4 * 1024 * 1024;
  const invalidXML = () => new Error("El XML está incompleto o no es una exportación válida de Salud.");

  function unescapeAttribute(text) {
    return text.replace(/&(amp|lt|gt|apos|quot|#\d+|#x[\da-fA-F]+);/g, (match, entity) => {
      const escapes = { amp: "&", lt: "<", gt: ">", apos: "'", quot: '"' };
      if (Object.hasOwn(escapes, entity)) return escapes[entity];
      const code = entity[1] === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (code > 0x10ffff || code < 1) throw invalidXML();
      return String.fromCodePoint(code);
    });
  }

  function attributes(tag) {
    const values = Object.create(null);
    const pattern = /\s+([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    for (const match of tag.matchAll(pattern)) {
      values[match[1]] = unescapeAttribute(match[2] ?? match[3]);
    }
    return values;
  }

  function dateParts(text) {
    if (!text) return null;
    const parts = /^(\d{4}-\d\d-\d\d)[ T](\d\d):(\d\d):(\d\d(?:\.\d+)?)\s*(Z|[+-]\d\d:?\d\d)$/.exec(text);
    if (!parts) return null;
    const [, day, hour, minute, second, zone] = parts;
    const offsetText = zone.replace(":", "");
    const offset = zone === "Z" ? 0 : (zone[0] === "-" ? -1 : 1) *
      (Number(offsetText.slice(1, 3)) * 60 + Number(offsetText.slice(3)) );
    const midnight = Date.parse(day + "T00:00:00Z");
    if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== day ||
        Number(hour) > 23 || Number(minute) > 59 || Number(second) >= 60 || Math.abs(offset) > 14 * 60) return null;
    const stamp = midnight + (Number(hour) * 60 + Number(minute) - offset) * MINUTE + Number(second) * 1000;
    return { day, stamp, offset, minuteOfDay: Number(hour) * 60 + Number(minute) };
  }

  function number(text) {
    if (text == null || !text.trim()) return null;
    const value = Number(text);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  function converted(text, unit, factors) {
    const value = number(text);
    return value === null || !Object.hasOwn(factors, unit) ? null : value * factors[unit];
  }

  // Keep disjoint intervals per night. Summaries and overlapping stages count once.
  function addInterval(intervals, start, end) {
    let index = intervals.length;
    while (index > 0 && intervals[index - 1][1] >= start) index--;
    let remove = 0;
    while (index + remove < intervals.length && intervals[index + remove][0] <= end) {
      const prior = intervals[index + remove];
      start = Math.min(start, prior[0]);
      end = Math.max(end, prior[1]);
      remove++;
    }
    intervals.splice(index, remove, [start, end]);
  }

  function addSleep(start, end, nights) {
    // The date of a sleep window is the date of its closing noon in the export's offset.
    const startLocal = start.stamp + start.offset * MINUTE;
    let closingNoon = Math.floor((startLocal + DAY / 2) / DAY) * DAY + DAY / 2;
    let cursor = start.stamp;
    while (cursor < end.stamp) {
      const label = new Date(closingNoon).toISOString().slice(0, 10);
      const offset = label >= end.day ? end.offset : start.offset;
      const stop = Math.min(end.stamp, closingNoon - offset * MINUTE);
      if (stop > cursor) {
        if (!nights.has(label)) nights.set(label, []);
        addInterval(nights.get(label), cursor, stop);
        cursor = stop;
      }
      closingNoon += DAY;
    }
  }

  function createSummary() {
    const days = Object.create(null);
    const nights = new Map();
    const pulses = new Map();
    const sources = new Set();
    function day(key) { return days[key] ??= {}; }

    function add(name, attrs) {
      const source = attrs.sourceName || "";
      if (!/huawei/i.test(source)) return;
      const start = dateParts(attrs.startDate);
      if (!start) return;
      const end = dateParts(attrs.endDate) ?? start;
      if (end.stamp < start.stamp) return;
      if (name === "Workout") {
        let duration = converted(attrs.duration, attrs.durationUnit, { min: 1, s: 1 / 60, h: 60 });
        if (duration === null) duration = (end.stamp - start.stamp) / MINUTE;
        const daily = day(start.day);
        daily.workouts = (daily.workouts ?? 0) + 1;
        daily.workoutMinutes = (daily.workoutMinutes ?? 0) + duration;
      } else if (attrs.type === "HKCategoryTypeIdentifierSleepAnalysis") {
        if (!/^HKCategoryValueSleepAnalysisAsleep(?:Unspecified|Core|Deep|REM)?$/.test(attrs.value) ||
            end.stamp === start.stamp) return;
        addSleep(start, end, nights);
      } else if (attrs.type === "HKQuantityTypeIdentifierHeartRate") {
        const value = converted(attrs.value, attrs.unit, { "count/min": 1, bpm: 1, "count/s": 60 });
        if (value === null || value === 0) return;
        const key = end.day;
        if (!pulses.has(key)) pulses.set(key, { count: 0, sum: 0, latest: -Infinity, bins: new Map() });
        const pulse = pulses.get(key);
        pulse.count++;
        pulse.sum += value;
        const binKey = Math.floor(end.minuteOfDay / 15) * 15;
        if (!pulse.bins.has(binKey)) pulse.bins.set(binKey, { sum: 0, count: 0 });
        const bin = pulse.bins.get(binKey);
        bin.sum += value;
        bin.count++;
        if (end.stamp >= pulse.latest) {
          pulse.latest = end.stamp;
          day(key).heartRate = value;
        }
      } else {
        let metric;
        let value;
        switch (attrs.type) {
          case "HKQuantityTypeIdentifierStepCount":
            metric = "steps";
            value = converted(attrs.value, attrs.unit, { count: 1 });
            break;
          case "HKQuantityTypeIdentifierDistanceWalkingRunning":
            metric = "distance";
            value = converted(attrs.value, attrs.unit, { km: 1, m: 0.001, mi: 1.609344 });
            break;
          case "HKQuantityTypeIdentifierActiveEnergyBurned":
            metric = "energy";
            value = converted(attrs.value, attrs.unit, { kcal: 1, Cal: 1, kJ: 1 / 4.184, J: 1 / 4184 });
            break;
          default: return;
        }
        if (value === null) return;
        const daily = day(start.day);
        daily[metric] = (daily[metric] ?? 0) + value;
      }
      sources.add(source);
    }

    function finish() {
      for (const [key, pulse] of pulses) {
        const daily = day(key);
        daily.averageHeartRate = pulse.sum / pulse.count;
        daily.pulse = [...pulse.bins].sort((a, b) => a[0] - b[0]).map(([minute, bin]) => ({
          time: String(Math.floor(minute / 60)).padStart(2, "0") + ":" + String(minute % 60).padStart(2, "0"),
          value: bin.sum / bin.count
        }));
      }
      for (const [key, intervals] of nights) {
        day(key).sleep = intervals.reduce((sum, [start, end]) => sum + (end - start) / MINUTE, 0);
      }
      if (!sources.size) throw new Error("No se encontraron mediciones de Huawei en este archivo de Salud. Comprueba las fuentes y los permisos de Huawei Health en el iPhone.");
      return { days, sources: Array.from(sources).sort() };
    }
    return { add, finish };
  }

  /** Finds the whole markup token, including quoted attributes and the Apple DTD's internal subset. */
  function markupEnd(text, start) {
    for (const [prefix, suffix] of [["<!--", "-->"], ["<![CDATA[", "]]>"], ["<?", "?>"]]) {
      if (text.startsWith(prefix, start)) {
        const i = text.indexOf(suffix, start + prefix.length);
        return i === -1 ? -1 : i + suffix.length;
      }
    }
    const declaration = text.startsWith("<!DOCTYPE", start);
    let quote = "";
    let depth = 0;
    for (let i = start + 1; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (declaration && c === "[") {
        depth++;
      } else if (declaration && c === "]") {
        depth--;
      } else if (c === ">" && !depth) {
        return i + 1;
      }
    }
    return -1;
  }

  async function read(file) {
    if (!file || !file.size) throw new Error("Selecciona un archivo XML exportado desde Salud.");
    const first = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    if (first[0] === 0x50 && first[1] === 0x4b) throw new Error("Descomprime el ZIP de Salud y selecciona el XML de datos que contiene.");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const summary = createSummary();
    const stack = [];
    let rootSeen = false;
    let carry = "";
    for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
      const last = offset + CHUNK_BYTES >= file.size;
      const bytes = await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer();
      let text;
      try { text = carry + decoder.decode(bytes, { stream: !last }); }
      catch { throw invalidXML(); }
      carry = "";
      let pos = 0;
      while (pos < text.length) {
        const start = text.indexOf("<", pos);
        if (!stack.length && text.slice(pos, start === -1 ? undefined : start).trim()) throw invalidXML();
        if (start === -1) break;
        const end = markupEnd(text, start);
        if (end === -1) {
          carry = text.slice(start);
          if (carry.length > MAX_TAG_LENGTH || last) throw invalidXML();
          break;
        }
        const tag = text.slice(start, end);
        pos = end;
        if (tag.startsWith("<!") || tag.startsWith("<?")) continue;
        const match = /^<(\/?)([\w:.-]+)(?=[\s/>])/.exec(tag);
        if (!match) throw invalidXML();
        const [, closing, name] = match;
        if (closing) {
          if (stack.pop() !== name) throw invalidXML();
          continue;
        }
        if (!stack.length) {
          if (rootSeen || name !== "HealthData") throw invalidXML();
          rootSeen = true;
        } else if (stack.length === 1 && (name === "Record" || name === "Workout")) {
          summary.add(name, attributes(tag));
        }
        if (!tag.endsWith("/>")) {
          if (stack.length >= 128) throw invalidXML();
          stack.push(name);
        }
      }
    }
    if (!rootSeen || stack.length) throw invalidXML();
    return summary.finish();
  }

  window.WatchImport = Object.freeze({ read });
})();
