import { registerGenerator } from '../core/registry';
import { pixelSort } from './image/pixel-sort';
import { mosaic } from './image/mosaic';
import { halftone } from './image/halftone';
import { dataMosh } from './image/data-mosh';
import { lumaMesh } from './image/luma-mesh';
import { opticalFlow } from './image/optical-flow';
import { linoCut } from './image/lino-cut';
import { ditherImage } from './image/dither-image';
import { asciiArt } from './image/ascii-art';
import { fbmTerrain } from './noise/fbm-terrain';
import { domainWarpMarble } from './noise/domain-warp-marble';
import { noisePerlin } from './noise/noise-perlin';
import { noiseFbm } from './noise/noise-fbm';
import { noiseTurbulence } from './noise/noise-turbulence';
import { noiseRidged } from './noise/noise-ridged';
import { noiseDomainWarp } from './noise/noise-domain-warp';
import { spirograph } from './geometry/spirograph';
import { lissajous } from './geometry/lissajous';
import { lsystem } from './geometry/lsystem';
import { mstWeb } from './geometry/mst-web';
import { chladni } from './geometry/chladni';
import { geoRosettes } from './geometry/geo-rosettes';
import { geoSuperformula } from './geometry/geo-superformula';
import { geoMoire } from './geometry/geo-moire';
// import { geoApolloian } from './geometry/geo-apollonian'; // TODO: Fix incomplete generator
import { geoIslamic } from './geometry/geo-islamic';
import { geoTruchet } from './geometry/geo-truchet';
import { stippling } from './plotter/stippling';
import { contourLines } from './plotter/contour-lines';
import { hatching } from './plotter/hatching';
import { contourTopo } from './plotter/contour-topo';
import { streamlines } from './plotter/streamlines';
import { tspArt } from './plotter/tsp-art';
import { circlePacking } from './plotter/circle-packing';
import { offsetPaths } from './plotter/offset-paths';
import { guilloche } from './plotter/guilloche';
import { halftoneDots } from './plotter/halftone-dots';
import { phyllotaxis } from './plotter/phyllotaxis';
import { meanderMaze } from './plotter/meander-maze';
import { scribbleShading } from './plotter/scribble-shading';
import { bezierRibbonWeaves } from './plotter/bezier-ribbon-weaves';
import { gameOfLife } from './cellular/game-of-life';
import { reactionDiffusion } from './cellular/reaction-diffusion';
import { forestFire } from './cellular/forest-fire';
import { edenGrowth } from './cellular/eden-growth';
import { percolation } from './cellular/percolation';
import { sandpile } from './cellular/sandpile';
import { cyclicCA } from './cellular/cyclic-ca';
import { briansBrain } from './cellular/brians-brain';
import { ageTrails } from './cellular/age-trails';
import { turingPatterns } from './cellular/turing-patterns';
import { crystalGrowth } from './cellular/crystal-growth';
import { dla } from './cellular/dla';
import { elementaryCA } from './cellular/elementary-ca';
import { orbital } from './animation/orbital';
import { flowingParticles } from './animation/flowing-particles';
import { flowFieldInk } from './animation/flow-field-ink';
import { attractorTrails } from './animation/attractor-trails';
import { curlFluid } from './animation/curl-fluid';
import { plasmaFeedback } from './animation/plasma-feedback';
import { kaleidoscope } from './animation/kaleidoscope';
import { waveInterference } from './animation/wave-interference';
import { voronoiCells } from './voronoi/voronoi-cells';
import { crackle } from './voronoi/crackle';
import { ridges } from './voronoi/ridges';
import { voronoiMosaic } from './voronoi/voronoi-mosaic';
import { delaunayMesh } from './voronoi/delaunay-mesh';
import { centroidalVoronoi } from './voronoi/centroidal-voronoi';
import { contourBands } from './voronoi/contour-bands';
import { fractured } from './voronoi/fractured';
import { depthCells } from './voronoi/depth-cells';
import { weightedVoronoi } from './voronoi/weighted-voronoi';
import { neighborBands } from './voronoi/neighbor-bands';

export function initializeGenerators() {
  registerGenerator(pixelSort);
  registerGenerator(mosaic);
  registerGenerator(halftone);
  registerGenerator(dataMosh);
  registerGenerator(lumaMesh);
  registerGenerator(opticalFlow);
  registerGenerator(linoCut);
  registerGenerator(ditherImage);
  registerGenerator(asciiArt);
  registerGenerator(fbmTerrain);
  registerGenerator(domainWarpMarble);
  registerGenerator(noisePerlin);
  registerGenerator(noiseFbm);
  registerGenerator(noiseTurbulence);
  registerGenerator(noiseRidged);
  registerGenerator(noiseDomainWarp);
  registerGenerator(spirograph);
  registerGenerator(lissajous);
  registerGenerator(lsystem);
  registerGenerator(mstWeb);
  registerGenerator(chladni);
  registerGenerator(geoRosettes);
  registerGenerator(geoSuperformula);
  registerGenerator(geoMoire);
  // registerGenerator(geoApolloian); // TODO: Fix incomplete generator
  registerGenerator(geoIslamic);
  registerGenerator(geoTruchet);
  registerGenerator(hatching);
  registerGenerator(stippling);
  registerGenerator(contourTopo);
  registerGenerator(contourLines);
  registerGenerator(streamlines);
  registerGenerator(tspArt);
  registerGenerator(circlePacking);
  registerGenerator(offsetPaths);
  registerGenerator(guilloche);
  registerGenerator(halftoneDots);
  registerGenerator(phyllotaxis);
  registerGenerator(meanderMaze);
  registerGenerator(scribbleShading);
  registerGenerator(bezierRibbonWeaves);
  registerGenerator(gameOfLife);
  registerGenerator(reactionDiffusion);
  registerGenerator(forestFire);
  registerGenerator(edenGrowth);
  registerGenerator(percolation);
  registerGenerator(sandpile);
  registerGenerator(cyclicCA);
  registerGenerator(briansBrain);
  registerGenerator(ageTrails);
  registerGenerator(turingPatterns);
  registerGenerator(crystalGrowth);
  registerGenerator(dla);
  registerGenerator(elementaryCA);
  registerGenerator(orbital);
  registerGenerator(flowingParticles);
  registerGenerator(flowFieldInk);
  registerGenerator(attractorTrails);
  registerGenerator(curlFluid);
  registerGenerator(plasmaFeedback);
  registerGenerator(kaleidoscope);
  registerGenerator(waveInterference);
  registerGenerator(voronoiCells);
  registerGenerator(crackle);
  registerGenerator(ridges);
  registerGenerator(voronoiMosaic);
  registerGenerator(delaunayMesh);
  registerGenerator(centroidalVoronoi);
  registerGenerator(contourBands);
  registerGenerator(fractured);
  registerGenerator(depthCells);
  registerGenerator(weightedVoronoi);
  registerGenerator(neighborBands);
}

export {
  pixelSort, mosaic, halftone, dataMosh, lumaMesh, opticalFlow, linoCut, ditherImage, asciiArt,
  fbmTerrain, domainWarpMarble,
  noisePerlin, noiseFbm, noiseTurbulence, noiseRidged, noiseDomainWarp,
  spirograph, lissajous, lsystem, mstWeb, chladni,
  geoRosettes, geoSuperformula, geoMoire, geoIslamic, geoTruchet,
  stippling, hatching, contourTopo, contourLines, streamlines, tspArt, circlePacking, offsetPaths,
  guilloche, halftoneDots, phyllotaxis, meanderMaze, scribbleShading, bezierRibbonWeaves,
  gameOfLife, reactionDiffusion,
  forestFire, edenGrowth, percolation, sandpile,
  cyclicCA, briansBrain, ageTrails, turingPatterns, crystalGrowth, dla, elementaryCA,
  orbital, flowingParticles, flowFieldInk, attractorTrails, curlFluid, plasmaFeedback,
  kaleidoscope, waveInterference,
  voronoiCells, crackle, ridges, voronoiMosaic, delaunayMesh, centroidalVoronoi, contourBands,
  fractured, depthCells, weightedVoronoi, neighborBands,
};
