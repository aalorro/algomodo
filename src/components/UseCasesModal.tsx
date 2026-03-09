import React from 'react';
import { useStore } from '../store';

const useCases = [
  {
    title: '1. Phone & Desktop Wallpapers',
    description: 'Create unique, high-resolution wallpapers for phones, tablets, and desktops. Every seed produces a one-of-a-kind design. Abstract patterns, noise gradients, and geometric compositions scale cleanly to any resolution without pixelation.',
    generators: 'Simplex Field, Domain Warp, Plasma Feedback, Moire, Curl Fluid',
  },
  {
    title: '2. Social Media Content',
    description: 'Stand out in crowded feeds with algorithmically generated visuals for posts, stories, banners, and thumbnails. Animated generators produce looping GIFs and short videos ideal for Reels, TikTok, and animated story backgrounds.',
    generators: 'Flow Field Ink, Kaleidoscope, Flowing Particles, Spirograph, Superformula',
  },
  {
    title: '3. NFT & Digital Collectibles',
    description: "Generative art is the foundation of on-chain collectible projects. Each seed produces a provably unique piece from a shared algorithm. Algomodo's deterministic RNG ensures every output is reproducible from its seed — ideal for prototyping collection aesthetics and exploring visual rarity.",
    generators: 'Voronoi Cells, Truchet Tiles, L-System, Guilloche, Phyllotaxis',
  },
  {
    title: '4. Album Covers & Music Visuals',
    description: 'Musicians and labels use procedural patterns for cover art, single artwork, and live visuals. Voronoi tessellations, fractal zooms, and reaction-diffusion textures produce complex, eye-catching imagery. Animated generators drive real-time visuals synced to audio during live performances.',
    generators: 'Plasma Feedback, Curl Fluid, Flow Field Ink, Kaleidoscope',
  },
  {
    title: '5. Textile & Surface Pattern Design',
    description: 'Fashion, interior, and product designers use tiling algorithms to create seamless repeating patterns for fabrics, wallpapers, ceramics, and packaging. Deterministic seeds guarantee exact reproducibility across print runs.',
    generators: 'Islamic Patterns, Truchet Tiles, Moire, Phyllotaxis, Tessellations',
  },
  {
    title: '6. Game & Film Asset Generation',
    description: 'Game developers and VFX artists use noise fields, cellular automata, and fractal algorithms to generate terrain heightmaps, cave systems, crystal formations, and organic textures — all without hand-painting.',
    generators: 'FBM Terrain, Ridged Multifractal, DLA, Crystal Growth, Turing Patterns',
  },
  {
    title: '7. Data Visualization & Infographics',
    description: 'Voronoi diagrams, Delaunay meshes, MST webs, and Steiner networks are foundational to data visualization — representing geographic boundaries, network topology, population density, and hierarchical relationships.',
    generators: 'Voronoi Cells, Delaunay Mesh, MST Web, Steiner Networks, Contour Lines',
  },
  {
    title: '8. Branding & Identity Design',
    description: 'A single seed produces a consistent visual identity; changing the seed generates infinite on-brand variations. This approach scales from a single logo to thousands of personalized assets while maintaining cohesion.',
    generators: 'Spirograph, Superformula, Guilloche, Rosettes, L-System',
  },
  {
    title: '9. Print Art & Gallery Work',
    description: 'Fine artists and printmakers use algorithmic processes to create limited-edition prints, plotter drawings, and large-format installations. SVG export feeds directly into pen plotters and laser cutters.',
    generators: 'Hatching, Stippling, TSP Art, Bezier Ribbon Weaves, Scribble Shading',
  },
  {
    title: '10. Educational & Scientific Illustration',
    description: "Educators and researchers use algorithmic visualizations to explain complex phenomena: cellular automata demonstrate emergence, fractals illustrate self-similarity, flow fields show vector calculus, and reaction-diffusion systems model biological morphogenesis.",
    generators: 'Game of Life, Mandelbrot, Julia Set, Reaction Diffusion, Chladni Figures',
  },
  {
    title: '11. Web & UI Design',
    description: 'Procedural backgrounds, loading animations, and decorative textures for websites, apps, and presentations. Noise gradients replace flat backgrounds. Animated particles create engaging hero sections. All generated client-side with zero asset weight.',
    generators: 'Simplex Field, Domain Warp, Flowing Particles, Halftone Dots, Pixel Sort',
  },
];

export const UseCasesModal: React.FC = () => {
  const { setOpenModal } = useStore();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 p-6 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Use Cases</h2>
          <button
            onClick={() => setOpenModal(null)}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-xl"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-sm text-gray-700 dark:text-gray-300">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Algorithmic art is a practical tool across creative and technical fields. Here are eleven ways people use generators like Algomodo.
          </p>

          {useCases.map((uc) => (
            <div key={uc.title} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-2">{uc.title}</h3>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">{uc.description}</p>
              <p className="text-xs text-blue-600 dark:text-blue-400">
                <span className="font-medium">Try:</span> {uc.generators}
              </p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-6">
          <button
            onClick={() => setOpenModal(null)}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-md font-semibold hover:bg-blue-700 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
