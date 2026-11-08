import { Root, Input, Status } from './CsvDropParts.js';

// The parts live in CsvDropParts.js (a client module). The namespace object is built here, outside it, so a server
// component can write `CsvDrop.Root`: a property of an object exported from a client module is not reachable there.
export * from './CsvDropParts.js';
export const CsvDrop = { Root, Input, Status };
