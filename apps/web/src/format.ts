/** «1 ч 25 мин», «12 мин», «меньше минуты». */
export function fmtTime(sec: number): string {
  const m = Math.round(sec / 60);
  if (sec > 0 && m === 0) return "меньше минуты";
  const h = Math.floor(m / 60);
  return h ? `${h} ч${m % 60 ? ` ${m % 60} мин` : ""}` : `${m} мин`;
}
