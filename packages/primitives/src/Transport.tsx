import { Root, Group, Play, Previous, Next, Start, End, Speed, Readout, Boundary } from './TransportParts.js';

// The parts live in TransportParts.js (a client module). The namespace object is built here, outside it, so a server
// component can write `Transport.Root`: a property of an object exported from a client module is not reachable there.
export * from './TransportParts.js';
export const Transport = { Root, Group, Play, Previous, Next, Start, End, Speed, Readout, Boundary };
