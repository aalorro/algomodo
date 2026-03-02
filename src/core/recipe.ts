import type { Recipe, Palette, CanvasSettings } from '../types';

export const RECIPE_VERSION = '1.0.0';

export function createRecipe(
  generatorId: string,
  seed: number,
  params: Record<string, any>,
  palette: Palette,
  canvasSettings: CanvasSettings,
  postFX?: Record<string, any>
): Recipe {
  return {
    generatorId,
    seed,
    params,
    palette,
    canvasSettings,
    postFX,
    version: RECIPE_VERSION,
  };
}

export function recipeToJSON(recipe: Recipe): string {
  return JSON.stringify(recipe, null, 2);
}

export function recipeFromJSON(json: string): Recipe {
  try {
    const recipe = JSON.parse(json) as Recipe;
    if (!recipe.version || !recipe.generatorId || recipe.seed === undefined) {
      throw new Error('Invalid recipe format');
    }
    return recipe;
  } catch (e) {
    throw new Error(`Failed to parse recipe: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function downloadRecipe(recipe: Recipe, filename: string = 'recipe.json') {
  const json = recipeToJSON(recipe);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadJSON(data: any, filename: string = 'data.json') {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function uploadRecipe(file: File): Promise<Recipe> {
  const text = await file.text();
  return recipeFromJSON(text);
}
