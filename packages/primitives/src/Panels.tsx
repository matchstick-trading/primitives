import { Root, Layer, List, Move } from './PanelsParts.js';

// The parts live in PanelsParts.js (a client module). The namespace object is built here, outside it, so a server
// component can write `Panels.Root`: a property of an object exported from a client module is not reachable there.
export * from './PanelsParts.js';
export const Panels = { Root, Layer, List, Move };
