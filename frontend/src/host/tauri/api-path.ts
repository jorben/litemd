// litemd: @tauri-apps/api/path 的替代（纯字符串运算，同时认 / 与 \）。
const SEP = /[\\/]/;
export async function dirname(p: string): Promise<string> {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i <= 0 ? (i === 0 ? p[0]! : ".") : p.slice(0, i);
}
export async function join(...parts: string[]): Promise<string> {
  const sep = parts.some((x) => x.includes("\\") && !x.includes("/")) ? "\\" : "/";
  const out: string[] = [];
  parts.forEach((part, k) => {
    part.split(SEP).forEach((seg, j) => {
      if (seg === "" && !(k === 0 && j === 0)) return;
      if (seg === ".") return;
      if (seg === ".." && out.length > 1 && out[out.length - 1] !== "..") out.pop();
      else out.push(seg);
    });
  });
  return out.join(sep);
}
