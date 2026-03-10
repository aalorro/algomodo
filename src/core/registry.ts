import type { Generator, GeneratorFamily } from '../types';

// Generator storage
const generators: Map<string, Generator> = new Map();
const families: Map<string, GeneratorFamily> = new Map();

// Cached lookup results — invalidated on registration
let cachedAllGenerators: Generator[] | null = null;
let cachedAllFamilies: GeneratorFamily[] | null = null;
const cachedByFamily: Map<string, Generator[]> = new Map();

function invalidateCaches() {
  cachedAllGenerators = null;
  cachedAllFamilies = null;
  cachedByFamily.clear();
}

export function registerGenerator(generator: Generator) {
  generators.set(generator.id, generator);

  // Auto-register family if not exists
  if (!families.has(generator.family)) {
    families.set(generator.family, {
      id: generator.family,
      name: generator.family.replace(/-/g, ' ').toUpperCase(),
      description: '',
    });
  }

  invalidateCaches();
}

export function getGenerator(id: string): Generator | undefined {
  return generators.get(id);
}

export function getGeneratorsByFamily(familyId: string): Generator[] {
  let cached = cachedByFamily.get(familyId);
  if (!cached) {
    cached = Array.from(generators.values()).filter(g => g.family === familyId);
    cachedByFamily.set(familyId, cached);
  }
  return cached;
}

export function getAllFamilies(): GeneratorFamily[] {
  if (!cachedAllFamilies) {
    cachedAllFamilies = Array.from(families.values()).sort((a, b) => a.name.localeCompare(b.name));
  }
  return cachedAllFamilies;
}

export function getAllGenerators(): Generator[] {
  if (!cachedAllGenerators) {
    cachedAllGenerators = Array.from(generators.values());
  }
  return cachedAllGenerators;
}

export function registerFamily(family: GeneratorFamily) {
  families.set(family.id, family);
  invalidateCaches();
}
