import { Root, Table, Header, Row, Time, Price, Size, Side, Summary, Status } from './TapeParts.js';

// The parts live in TapeParts.js (a client module). The namespace object is built here, outside it, so a server
// component can write `Tape.Root`: a property of an object exported from a client module is not reachable there.
export * from './TapeParts.js';
export const Tape = { Root, Table, Header, Row, Time, Price, Size, Side, Summary, Status };
