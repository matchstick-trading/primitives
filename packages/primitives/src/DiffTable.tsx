import { Root, Header, Row, Price, QtyA, QtyB, Delta, ChangeMark } from './DiffTableParts.js';

// The parts live in DiffTableParts.js (a client module). The namespace object is built here, outside it, so a server
// component can write `DiffTable.Root`: a property of an object exported from a client module is not reachable there.
export * from './DiffTableParts.js';
export const DiffTable = { Root, Header, Row, Price, QtyA, QtyB, Delta, ChangeMark };
