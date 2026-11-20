(() => {
  "use strict";
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const format = (value, decimals = 0) => Number.isFinite(value)
    ? new Intl.NumberFormat("es-ES", {useGrouping: "always", maximumFractionDigits: decimals}).format(value) : "—";
  const duration = value => {
    if (!Number.isFinite(value)) return "—";
    const mins = Math.round(value);
    return Math.floor(mins / 60) + " h " + String(mins % 60).padStart(2, "0") + " m";
  };
  const dayKey = date => [date.getFullYear(), String(date.getMonth()+1).padStart(2,"0"), String(date.getDate()).padStart(2,"0")].join("-");
  const dateFrom = key => new Date(key + "T12:00:00");
  const dayBefore = (key, offset) => { const d = dateFrom(key); d.setDate(d.getDate() - offset); return dayKey(d); };
  const dateText = (key, options) => dateFrom(key).toLocaleDateString("es-ES", options);
  const today = dayKey(new Date());
  const capitalize = str => str.charAt(0).toUpperCase() + str.slice(1);

  function exampleData() {
    const days = {};
    for (let ago = 0; ago < 28; ago++) {
      const key = dayBefore(today, ago);
      const pulse = Array.from({length: 96}, (_, n) => {
        const hour = Math.floor(n / 4);
        const resting = (hour < 6 ? 58 : 72) + 3.8 * Math.sin(ago*.75) - 2.5 * Math.sin(ago*1.7);
        const activity = 33 * Math.exp(-Math.pow((n - 36) / 5, 2)) + 47 * Math.exp(-Math.pow((n - 68) / 6, 2));
        const variation = Math.sin(n * 1.33 + ago) * 4 + Math.cos(n * .5 - ago) * 3 + Math.sin(n * 2.4) * 2;
        return {time: String(hour).padStart(2,"0") + ":" + String(n % 4 * 15).padStart(2,"0"), value: Math.round(resting + activity + variation)};
      });
      const steps = Math.round(8432 + Math.sin(ago*2.2)*2100 - Math.sin(ago*.8)*1800);
      const workouts = ago % 3 === 1 ? 0 : 1;
      days[key] = {steps, distance:steps*.000735, energy:Math.round(426+Math.sin(ago*1.6)*111),
        sleep:Math.round(438+Math.sin(ago*2.4)*47), workouts, workoutMinutes:workouts ? 36 + ago % 18 : 0,
        averageHeartRate:pulse.reduce((sum,p)=>sum+p.value,0)/pulse.length, heartRate:pulse.at(-1).value, pulse};
    }
    return {days,sources:[]};
  }

  const example = exampleData();
  let imported = null, data = example, selected = today, range = "day", historyLimit = 4;
  const iconPaths = {
    brand:"M2 13h5l3-8 4 15 3-10 2 3h3",grid:"M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    trend:"M3 17l6-7 4 4 8-10 M15 4h6v6",history:"M3 11a9 9 0 1 1 2 7 M2 6v5h5 M12 7v5l4 2",
    watch:"M8 6V4l1-2h6l1 2v2 M8 18v2l1 2h6l1-2v-2 M12 5a7 7 0 1 0 .01 0 M12 8v4l3 1",
    database:"M4 6c0-4 16-4 16 0s-16 4-16 0z M4 6v12c0 4 16 4 16 0V6 M4 12c0 4 16 4 16 0",
    shield:"M12 2l8 4v6q0 6-8 10-8-4-8-10V6z M8 12l3 3 5-6",
    calendar:"M4 5h16v16H4z M8 2v6 M16 2v6 M4 10h16",down:"M5 9l7 7 7-7",
    import:"M12 15V3 M7 8l5-5 5 5 M4 14v6h16v-6",
    foot:"M8 3q-3 0-4 5t2 5q3 0 4-5t-2-5z M5 16l3 1-1 3-3-1z M17 7q3 1 2 6t-4 4q-2-1-1-6t3-4z M14 20l3 1-1 2-3-1z",
    heart:"M12 20L4 12C-2 5 7-1 12 6c5-7 14-1 8 6z",
    moon:"M18 17A8 8 0 0 1 9 4a9 9 0 1 0 11 12z",
    flame:"M13 2q1 6 5 9 4 4 1 8-5 5-11 1-5-4-2-10 1 3 4 3-1-7 3-11z",
    close:"M5 5l14 14 M19 5L5 19"
  };
  function canvasSetup(canvas, width, height) {
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.max(1,Math.round(width * ratio));
    canvas.height = Math.max(1,Math.round(height * ratio));
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio,ratio);
    return ctx;
  }
  for (const box of $$("[data-icon]")) {
    const name = box.dataset.icon;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden","true");
    box.classList.add("icon-" + name);
    box.append(canvas);
    const ctx = canvasSetup(canvas,24,24);
    ctx.strokeStyle = getComputedStyle(box).color;
    ctx.lineWidth = name === "brand" ? 2.6 : 1.65;
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.stroke(new Path2D(iconPaths[name]));
  }
  for (const link of $$(".rail .navitem")) link.setAttribute("aria-label",link.textContent.trim());

  function spark(canvas, values, color, bars) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const ctx = canvasSetup(canvas,w,h);
    const samples = values.filter(Number.isFinite);
    if (!samples.length || !w) return;
    const min = bars ? 0 : Math.min(...samples) * .93, max = Math.max(min+1,...samples);
    const y = v => h-2-(v-min)/(max-min)*(h-5);
    ctx.strokeStyle = ctx.fillStyle = color;
    ctx.lineWidth=2;ctx.lineCap="round";ctx.lineJoin="round";
    ctx.beginPath();
    let connect = false;
    values.forEach((v,i) => {
      if (!Number.isFinite(v)) {connect=false;return;}
      const x = 2+i*(w-4)/Math.max(1,values.length-1);
      if (bars) ctx.fillRect(i*w/values.length,y(v),Math.max(2,w/values.length-2),Math.max(1,h-y(v)));
      else {
        if (connect) ctx.lineTo(x,y(v)); else ctx.moveTo(x,y(v));
        ctx.fillRect(x-1,y(v)-1,2,2);connect=true;
      }
    });
    ctx.stroke();
    canvas.title="Últimos siete días";
  }
  let chartPoints = [];
  function drawChart() {
    const canvas = $("#chart"), w = canvas.clientWidth, h = canvas.clientHeight;
    const ctx = canvasSetup(canvas,w,h);
    const dates = Array.from({length:7},(_,n)=>dayBefore(selected,6-n));
    const daily = data.days[selected] || {};
    const items = range === "day" ? (daily.pulse || []).map(p=>{
      const [hours,minutes] = p.time.split(":").map(Number);
      return {u:(hours*60+minutes)/1440, label:p.time, value:p.value};
    }) : dates.map((key,i)=>({u:i/6,label:dateText(key,{day:"numeric",month:"short"}),value:data.days[key]?.averageHeartRate}));
    const valid = items.filter(p=>Number.isFinite(p.value));
    const nums=valid.map(p=>p.value);
    const avg = range === "day" ? daily.averageHeartRate : nums.length ? nums.reduce((a,b)=>a+b,0)/nums.length : null;
    $("#chart-value").textContent=format(avg);
    $("#chart-context").textContent=range==="day"?"Media diaria":"Media de los días con datos";
    $("#chart-extents").textContent=nums.length?"Mín. "+format(Math.min(...nums))+" · Máx. "+format(Math.max(...nums))+" lpm":"";
    $("#chart-empty").hidden=!!nums.length;
    $("#chart-tip").hidden=true;
    canvas.setAttribute("aria-label",(range==="day"?"Pulso por intervalos de 15 minutos":"Pulso medio de los últimos siete días")+". Media "+format(avg)+" lpm. "+$("#chart-extents").textContent);
    const left=30,right=w-14,top=10,bottom=h-25;
    const low=nums.length?Math.max(0,Math.floor((Math.min(...nums)-5)/10)*10):40;
    const high=nums.length?Math.ceil((Math.max(...nums)+5)/10)*10:120;
    const x = u => left + (right-left)*u;
    const y = v => bottom-(bottom-top)*(v-low)/(high-low);
    ctx.font='11px "Segoe UI",sans-serif';
    ctx.textBaseline="middle";
    for(let n=0;n<=4;n++){
      const v=low+(high-low)*n/4, py=y(v);
      ctx.fillStyle="#a6abb0";ctx.textAlign="left";ctx.fillText(format(v),0,py);
      ctx.strokeStyle="#34383c";ctx.lineWidth=1;ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(left,py);ctx.lineTo(right,py);ctx.stroke();
    }
    ctx.setLineDash([]);
    const labels = range==="day"?["00:00","06:00","12:00","18:00","24:00"]:dates.map(k=>dateText(k,{weekday:"short"}).replace(".",""));
    labels.forEach((s,i)=>{ctx.fillStyle="#a6abb0";ctx.textAlign=i===0?"left":i===labels.length-1?"right":"center";ctx.fillText(s,x(i/(labels.length-1)),h-9);});
    chartPoints=valid.map(p=>({...p,x:x(p.u),y:y(p.value)}));
    const gradient=ctx.createLinearGradient(0,top,0,bottom);
    gradient.addColorStop(0,"rgba(255,121,85,.33)");gradient.addColorStop(1,"rgba(255,121,85,.015)");
    const groups=[];
    for(const p of chartPoints){
      const previous=groups.at(-1)?.at(-1);
      if(!previous || p.u-previous.u > (range==="day"?1/24:1/6+.001)) groups.push([]);
      groups.at(-1).push(p);
    }
    for(const group of groups){
      const line=new Path2D();
      group.forEach((p,i)=> i ? line.lineTo(p.x,p.y):line.moveTo(p.x,p.y));
      const area=new Path2D(line);area.lineTo(group.at(-1).x,bottom);area.lineTo(group[0].x,bottom);area.closePath();
      ctx.fillStyle=gradient;ctx.fill(area);ctx.strokeStyle="#ff805c";ctx.lineWidth=2.4;ctx.lineCap=ctx.lineJoin="round";ctx.stroke(line);
      if(group.length===1 || range==="week")for(const p of group){ctx.fillStyle="#ff805c";ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fill();}
    }
  }
  $("#chart").addEventListener("pointermove",e=>{
    if(!chartPoints.length)return;
    const px=e.clientX-e.currentTarget.getBoundingClientRect().left;
    const p=chartPoints.reduce((a,b)=>Math.abs(a.x-px)<Math.abs(b.x-px)?a:b);
    const tip=$("#chart-tip");tip.hidden=false;tip.textContent=p.label+" · "+format(p.value)+" lpm";
    tip.style.left=Math.max(0,Math.min(e.currentTarget.clientWidth-tip.offsetWidth,p.x-40))+"px";
  });
  $("#chart").addEventListener("pointerleave",()=>{$("#chart-tip").hidden=true;});

  function displayHistory(){
    const dates=Object.keys(data.days).filter(key=>key<=selected).sort().reverse();
    const body=$("#records");body.replaceChildren();
    for(const key of dates.slice(0,historyLimit)){
      const day=data.days[key], row=body.insertRow(), button=document.createElement("button");
      button.className="day-link";button.textContent=capitalize(dateText(key,{weekday:"short",day:"numeric",month:"short",year:"numeric"}));
      button.addEventListener("click",()=>{selected=key;render();document.getElementById("resumen").scrollIntoView();setNav("#resumen");});
      row.insertCell().append(button);
      for(const text of [format(day.steps),Number.isFinite(day.distance)?format(day.distance,2)+" km":"—",Number.isFinite(day.averageHeartRate)?format(day.averageHeartRate)+" lpm":"—",duration(day.sleep),format(day.workouts)])row.insertCell().textContent=text;
    }
    if(!dates.length){const cell=body.insertRow().insertCell();cell.colSpan=6;cell.textContent="Sin registros hasta esta fecha.";}
    const btn=$("#history-toggle");btn.hidden=dates.length<=4;btn.textContent=historyLimit>=dates.length?"Ver menos":"Ver más días";
  }
  function render(){
    const day=data.days[selected]||{};
    $("#date-picker").value=selected;
    $("#date-label").textContent=selected===today?"Hoy":dateText(selected,{day:"numeric",month:"short"});
    $("#view-date").textContent=capitalize(dateText(selected,{weekday:"long",day:"numeric",month:"long",year:"numeric"}));
    $("#mode b").textContent=imported?"Datos importados":"Datos de ejemplo";
    $("#mode").classList.toggle("live",!!imported);
    const foot={
      steps:Number.isFinite(day.distance)?format(day.distance,2)+" km":"Distancia sin datos",
      averageHeartRate:Number.isFinite(day.heartRate)?"Último: "+format(day.heartRate)+" lpm":"Sin lectura reciente",
      sleep:"Tiempo dormido",energy:"Kilocalorías"
    };
    for(const card of $$(".metric")){
      const key=card.dataset.k,v=day[key];
      card.querySelector("strong").textContent=key==="sleep"?duration(v):format(v);
      card.querySelector("small").textContent=Number.isFinite(v)?foot[key]:"Sin datos";
      card.querySelector(".big span").hidden=!Number.isFinite(v);
      const samples=Array.from({length:7},(_,i)=>data.days[dayBefore(selected,6-i)]?.[key]);
      spark(card.querySelector(".metric-foot canvas"),samples,getComputedStyle(card).getPropertyValue("--metric"),key==="steps"||key==="sleep");
    }
    drawChart();displayHistory();
    $("#data-controls").hidden=!imported;
    if(imported)$("#source-info").textContent="Fuente: "+imported.sources.join(", ")+" · "+Object.keys(imported.days).length+" días con datos.";
  }
  $("#date-picker").addEventListener("change",e=>{if(e.target.value){selected=e.target.value;historyLimit=4;render();}});
  $("#date-picker").addEventListener("click",e=>{try{e.target.showPicker?.();}catch{}});
  for(const button of $$("[data-range]"))button.addEventListener("click",()=>{range=button.dataset.range;for(const b of $$("[data-range]"))b.setAttribute("aria-pressed",String(b===button));drawChart();});
  $("#history-toggle").addEventListener("click",()=>{const count=Object.keys(data.days).filter(key=>key<=selected).length;historyLimit=historyLimit>=count?4:historyLimit+14;displayHistory();});
  function setNav(hash){for(const link of $$(".rail nav a")){link.classList.toggle("active",link.hash===hash);if(link.hash===hash){link.setAttribute("aria-current","location");$(".crumb strong").textContent=link.textContent.trim();}else link.removeAttribute("aria-current");}}
  window.addEventListener("hashchange",()=>setNav(location.hash||"#resumen"));
  setNav(location.hash||"#resumen");
  const dialog=$("#data-dialog");
  for(const button of $$("[data-open-data]"))button.addEventListener("click",()=>dialog.showModal());
  $("#close").addEventListener("click",()=>dialog.close());
  dialog.addEventListener("click",e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  $("#pick-file").addEventListener("click",()=>$("#file").click());

  function stored(action,value) {
    return new Promise((resolve,reject)=>{
      const opening=indexedDB.open("WatchUpgradeDashboard",1);
      opening.onupgradeneeded=()=>opening.result.createObjectStore("summaries");
      opening.onerror=()=>reject(opening.error);
      opening.onsuccess=()=>{
        const db=opening.result, tx=db.transaction("summaries",action==="get"?"readonly":"readwrite");
        const store=tx.objectStore("summaries");
        const request=action==="get"?store.get("current"):action==="put"?store.put(value,"current"):store.delete("current");
        tx.oncomplete=()=>{db.close();resolve(request.result);};
        tx.onabort=()=>{db.close();reject(tx.error);};
      };
    });
  }
  function activate(summary, keepDate){
    const old=selected;
    imported=summary;data=summary||example;
    selected=keepDate && data.days[old]?old:Object.keys(data.days).sort().at(-1)||today;
    historyLimit=4;render();
  }
  async function importFile(file, automatic=false){
    const status=$("#import-status");status.textContent="Leyendo el XML de Salud…";
    try{
      const summary=await window.WatchImport.read(file);
      let saved=true;
      try{await stored("put",summary);}catch{saved=false;}
      activate(summary,automatic && !!imported && selected!==Object.keys(imported.days).sort().at(-1));
      status.textContent=saved?"Importación completada. Ya puedes consultar tus mediciones.":"Datos disponibles en esta sesión. El navegador no ha podido guardarlos.";
    }catch(err){status.textContent=err.message||"No se pudo importar el archivo.";throw err;}
  }
  const sync=window.WatchFileSync.create({
    onFile:file=>importFile(file,true),
    onStatus:({state,name,message})=>{
      $("#sync-text").textContent=(name?name+" · ":"")+message;
      $("#sync-choose").hidden=state==="unsupported";
      $("#sync-reconnect").hidden=state!=="permission";
      $("#sync-stop").hidden=!name;
    }
  });
  $("#sync-choose").addEventListener("click",()=>sync.choose());
  $("#sync-stop").addEventListener("click",()=>sync.disconnect());
  $("#sync-reconnect").addEventListener("click",()=>sync.reconnect());
  $("#file").addEventListener("change",async e=>{
    const file=e.target.files[0];e.target.value="";if(!file)return;
    $("#pick-file").disabled=true;
    try{await sync.disconnect();await importFile(file);}catch{}finally{$("#pick-file").disabled=false;}
  });
  $("#clear-data").addEventListener("click",async()=>{
    if(!window.confirm("¿Borrar el resumen guardado en este navegador y desvincular el archivo?"))return;
    await sync.disconnect();
    try{await stored("delete");activate(null,false);$("#import-status").textContent="Datos borrados. El panel muestra el ejemplo.";}
    catch{$("#import-status").textContent="El navegador no ha podido confirmar el borrado.";}
  });
  render();
  let redraw;
  window.addEventListener("resize",()=>{cancelAnimationFrame(redraw);redraw=requestAnimationFrame(render);});
  (async()=>{let cached;try{cached=await stored("get");}catch{}
    if(cached?.days && Object.keys(cached.days).length)activate(cached,false);
    await sync.restore({hasData:!!imported});
  })();
})();
