window.WatchGoals = (() => {
  const storageKey = "watch-upgrade.weekly-goal.v1";
  const types = {
    walking: {name:"Distancia en paseos registrados",unit:"km",step:"0.1",sample:40},
    distance: {name:"Distancia a pie y corriendo",unit:"km",step:"0.1",sample:40},
    steps: {name:"Pasos",unit:"pasos",step:"1",sample:50000},
    workoutMinutes: {name:"Tiempo de entrenamiento",unit:"min",step:"1",sample:150}
  };
  const fmt = num => num.toLocaleString("es-ES",{maximumFractionDigits:1});
  function weekly(summary, date, metric) {
    const end = new Date(date+"T12:00:00Z");
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);
    const monday = start.toISOString().slice(0,10);
    let values;
    if (metric === "walking") {
      values = (summary.workouts || []).filter(w => w.day >= monday && w.day <= date && w.type==="HKWorkoutActivityTypeWalking").map(w=>w.distanceKm);
    } else {
      values = Object.entries(summary.days).filter(([key])=>key>=monday && key<=date).map(([,day])=>day[metric]);
    }
    const readings=values.filter(Number.isFinite);
    return {monday,total:readings.length ? readings.reduce((a,b)=>a+b,0) : null};
  }
  function mount(container) {
    let goal=null, context=null;
    try {
      const saved=JSON.parse(localStorage.getItem(storageKey));
      if (saved && Object.hasOwn(types,saved.metric) && Number.isFinite(saved.target) && saved.target>0) goal=saved;
    } catch {}
    const form=container.querySelector("form"), metric=form.elements.metric, target=form.elements.target;
    for(const [key,t] of Object.entries(types)) metric.add(new Option(t.name,key));
    function edit(){
      metric.value=goal?.metric || "walking";
      const t=types[metric.value];
      target.step=t.step;target.min=t.step;target.value=goal?.target??t.sample;
      container.querySelector(".goal-unit").textContent=t.unit;
      form.hidden=false;container.querySelector(".goal-edit").hidden=true;
    }
    metric.addEventListener("change",()=>{
      const t=types[metric.value];
      target.min=target.step=t.step;target.value=t.sample;container.querySelector(".goal-unit").textContent=t.unit;
    });
    container.querySelector(".goal-edit").addEventListener("click",()=>{edit();metric.focus();});
    form.addEventListener("submit",e=>{
      e.preventDefault();if(!form.reportValidity())return;
      goal={metric:metric.value,target:target.valueAsNumber};
      try {localStorage.setItem(storageKey,JSON.stringify(goal));}catch{container.querySelector(".goal-status").textContent="El objetivo solo se guardará durante esta sesión.";}
      form.hidden=true; container.querySelector(".goal-edit").hidden=false;
      render(...context);
    });
    function render(summary,date){
      context=[summary,date];
      const output=container.querySelector(".goal-output");
      output.hidden=!goal;
      if(!goal)return;
      const t=types[goal.metric], {monday,total}=weekly(summary,date,goal.metric);
      const label = key => new Date(key+"T12:00:00").toLocaleDateString("es-ES",{day:"numeric",month:"short"});
      container.querySelector(".goal-period").textContent=t.name+" · "+label(monday)+" – "+label(date);
      container.querySelector(".goal-value").textContent=(total===null?"—":fmt(total))+" / "+fmt(goal.target)+" "+t.unit;
      const progress=container.querySelector("progress");progress.max=goal.target;progress.value=Math.min(total||0,goal.target);
      container.querySelector(".goal-remaining").textContent=total===null?"Sin registros de esta actividad en el periodo.":total>=goal.target?"Objetivo alcanzado":"Te quedan "+fmt(goal.target-total)+" "+t.unit+".";
    }
    if(!goal)edit();
    return render;
  }
  return {mount,weekly};
})();
