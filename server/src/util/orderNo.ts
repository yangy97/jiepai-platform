/**
 * 订单号生成：JP + yyyyMMddHHmmss + 4 位随机
 */
export function genOrderNo(): string {
  const d = new Date();
  const p = (n: number, len = 2) => String(n).padStart(len, '0');
  const stamp =
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const rand = p(Math.floor(Math.random() * 10000), 4);
  return `JP${stamp}${rand}`;
}
