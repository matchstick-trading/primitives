import { Root, Table, Row, Last, Price, Size, Traded, Status } from './LadderParts.js';

// The parts live in LadderParts.js (a client module). The namespace object is built here, outside it, so a server
// component can write `Ladder.Root`: a property of an object exported from a client module is not reachable there.
export * from './LadderParts.js';
export const Ladder = { Root, Table, Row, Last, Price, Size, Traded, Status };
