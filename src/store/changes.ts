import type { LearningData } from "./model";
export type LearningChange =
  | { op: "set"; path: string[]; value: unknown }
  | { op: "remove"; path: string[] };
export function learningChanges(
  base: LearningData,
  next: LearningData,
): LearningChange[] {
  const changes: LearningChange[] = [];
  const same = (a: unknown, b: unknown) =>
    a === b || JSON.stringify(a) === JSON.stringify(b);
  for (const key of Object.keys(
    next.settings,
  ) as (keyof LearningData["settings"])[])
    if (!same(base.settings[key], next.settings[key]))
      changes.push({
        op: "set",
        path: ["settings", key],
        value: next.settings[key],
      });
  for (const id of Object.keys(base.datasets))
    if (!Object.hasOwn(next.datasets, id))
      changes.push({ op: "remove", path: ["datasets", id] });
  for (const [id, p] of Object.entries(next.datasets)) {
    const prev = base.datasets[id];
    if (!prev) {
      changes.push({ op: "set", path: ["datasets", id], value: p });
      continue;
    }
    for (const field of ["cards", "days"] as const) {
      for (const key of Object.keys(prev[field]))
        if (!Object.hasOwn(p[field], key))
          changes.push({ op: "remove", path: ["datasets", id, field, key] });
      for (const [key, value] of Object.entries(p[field]))
        if (!same(prev[field][key], value))
          changes.push({
            op: "set",
            path: ["datasets", id, field, key],
            value,
          });
    }
    for (const field of ["bookmarks", "typing", "session", "mistakes"] as const)
      if (!same(prev[field], p[field]))
        changes.push({
          op: "set",
          path: ["datasets", id, field],
          value: p[field],
        });
  }
  return changes;
}
