import { Root, Layer, Toolbar, List, Remove, Undo, Lock, Edit } from './DrawingsParts.js';

// The parts live in DrawingsParts.js (a client module). The namespace object is built here, outside it, so a server
// component can write `Drawings.Root`: a property of an object exported from a client module is not reachable there.
export * from './DrawingsParts.js';
export const Drawings = { Root, Layer, Toolbar, List, Remove, Undo, Lock, Edit };
