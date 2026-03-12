import type { Palette } from '../types';

function randomHex(): string {
  return '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0').toUpperCase();
}

export const CURATED_PALETTES: Palette[] = [
  {
    name: 'Vibrant',
    colors: ['#FF006E', '#FB5607', '#FFBE0B', '#8338EC', '#3A86FF'],
  },
  {
    name: 'Ocean',
    colors: ['#03045E', '#0077B6', '#00B4D8', '#90E0EF', '#CAF0F8'],
  },
  {
    name: 'Sunset',
    colors: ['#FF4800', '#FF6000', '#FF8500', '#FFB300', '#FFDB00'],
  },
  {
    name: 'Forest',
    colors: ['#1B4332', '#2D6A4F', '#40916C', '#74C69D', '#D8F3DC'],
  },
  {
    name: 'Mono',
    colors: ['#111111', '#333333', '#666666', '#999999', '#EEEEEE'],
  },
  {
    name: 'Pastel',
    colors: ['#FFB3BA', '#FFDFBA', '#FFFFBA', '#BAFFC9', '#BAE1FF'],
  },
  {
    name: 'Neon',
    colors: ['#FF00FF', '#00FFFF', '#FFFF00', '#FF0080', '#00FF80'],
  },
  {
    name: 'Ember',
    colors: ['#1A0000', '#5C0A00', '#B32000', '#E05000', '#FF8040'],
  },
  {
    name: 'Arctic',
    colors: ['#E0F7FA', '#80DEEA', '#26C6DA', '#00838F', '#004D40'],
  },
  {
    name: 'Cosmic',
    colors: ['#0D0221', '#0A0548', '#450920', '#A2095B', '#E9178A'],
  },
  {
    name: 'Rainbow',
    colors: ['#FF0000', '#FF8800', '#FFFF00', '#00CC44', '#0066FF'],
  },
  {
    name: 'Contrast',
    colors: ['#000000', '#FFFFFF', '#FF0000', '#FFFF00', '#0000FF'],
  },
  {
    name: 'Nature',
    colors: ['#264653', '#2A9D8F', '#E9C46A', '#F4A261', '#E76F51'],
  },
  {
    name: 'Earth',
    colors: ['#3D2B1F', '#6B4226', '#A67B5B', '#C4A882', '#E8D5B7'],
  },
  {
    name: 'Random',
    colors: [randomHex(), randomHex(), randomHex(), randomHex(), randomHex()],
  },
];
