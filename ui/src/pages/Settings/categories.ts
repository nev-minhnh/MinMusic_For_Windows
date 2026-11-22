import type { Component } from "solid-js";

/** What a pages/Settings/<Category>/index.tsx exports (conventions section 2). */
export type SettingsCategory = { key: string; order: number; icon: string; titleKey: string };
export type CategoryModule = { category?: SettingsCategory; default?: Component };
export type LoadedCategory = SettingsCategory & { component: Component };

export function loadCategories(mods: Record<string, CategoryModule>): LoadedCategory[] {
  const out: LoadedCategory[] = [];
  for (const m of Object.values(mods)) if (m.category && m.default) out.push({ ...m.category, component: m.default });
  return out.sort((a, b) => a.order - b.order);
}

// eager: a category is a handful of rows, the shell shows the list at once
export const categories = (): LoadedCategory[] => loadCategories(import.meta.glob<CategoryModule>("./*/index.tsx", { eager: true }));
