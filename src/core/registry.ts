import type { Generator, GeneratorFamily } from '../types';

// Generator storage
const generators: Map<string, Generator> = new Map();
const families: Map<string, GeneratorFamily> = new Map();

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
}

export function getGenerator(id: string): Generator | undefined {
  return generators.get(id);
}

export function getGeneratorsByFamily(familyId: string): Generator[] {
  return Array.from(generators.values()).filter(g => g.family === familyId);
}

export function getAllFamilies(): GeneratorFamily[] {
  return Array.from(families.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function getAllGenerators(): Generator[] {
  return Array.from(generators.values());
}

export function registerFamily(family: GeneratorFamily) {
  families.set(family.id, family);
}
