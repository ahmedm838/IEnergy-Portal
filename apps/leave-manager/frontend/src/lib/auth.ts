
export function normalizeLogin(input: string): string {
  const v = input.trim();
  if (!v) return v;
  return v.includes("@") ? v : `${v}@ienergy.local`;
}
