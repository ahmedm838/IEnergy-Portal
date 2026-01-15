export const qs = (sel, root=document) => root.querySelector(sel);
export const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));

export function isNonEmptyString(v){ return typeof v === "string" && v.trim().length > 0; }

export function fmtDateISO(d){
  // d: Date
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

export function showToast(message, type="good"){
  const host = qs("#toast");
  if(!host) return;
  const el = document.createElement("div");
  el.className = `toast ${type==="danger"?"bad":type}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(()=>{ el.style.opacity="0"; el.style.transform="translateY(6px)"; }, 2600);
  setTimeout(()=>{ el.remove(); }, 3300);
}

export function round2(n){
  const x = Number(n);
  if(!Number.isFinite(x)) return 0;
  return Math.round(x*100)/100;
}

export function countWorkingDays(fromISO, toISO, weekendDays=[5,6]){
  // Inclusive range. Returns number of non-weekend days.
  const from = new Date(fromISO+"T00:00:00");
  const to = new Date(toISO+"T00:00:00");
  if(isNaN(from.getTime()) || isNaN(to.getTime())) return 0;
  if(from>to) return 0;
  let count=0;
  for(let d=new Date(from); d<=to; d.setDate(d.getDate()+1)){
    const day = d.getDay();
    if(!weekendDays.includes(day)) count++;
  }
  return count;
}

export function time24To12(t24){
  // "HH:MM" -> "hh:mm AM/PM"
  if(!t24) return "";
  const [hh, mm] = t24.split(":").map(Number);
  if(!Number.isFinite(hh) || !Number.isFinite(mm)) return "";
  const ampm = hh>=12 ? "PM" : "AM";
  const h12 = ((hh+11)%12)+1;
  return `${String(h12).padStart(2,"0")}:${String(mm).padStart(2,"0")} ${ampm}`;
}

export function time12To24(t12){
  // Accept "hh:mm AM/PM" (case-insensitive). Returns "HH:MM" or null.
  if(!t12 || typeof t12 !== "string") return null;
  const s = t12.trim().toUpperCase();
  const m = s.match(/^([0-1]?\d):([0-5]\d)\s*(AM|PM)$/);
  if(!m) return null;
  let h = Number(m[1]);
  const mm = Number(m[2]);
  const ap = m[3];
  if(h===0 || h>12) return null;
  if(ap==="AM"){ if(h===12) h=0; }
  else { if(h!==12) h+=12; }
  return `${String(h).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
}

export function hoursBetween(t24_in, t24_out){
  // t24: "HH:MM"
  const [h1,m1] = t24_in.split(":").map(Number);
  const [h2,m2] = t24_out.split(":").map(Number);
  const a = h1*60+m1;
  const b = h2*60+m2;
  return (b-a)/60;
}
