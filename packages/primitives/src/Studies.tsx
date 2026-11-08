import { Root, Line, Band, Legend } from './StudiesParts.js';

// The parts live in StudiesParts.js (a client module). The namespace object is built here, outside it, so a server
// component can write `Study.Root`: a property of an object exported from a client module is not reachable there.
export * from './StudiesParts.js';
export const Study = { Root, Line, Band, Legend };
