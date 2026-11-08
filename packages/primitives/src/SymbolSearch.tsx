import { Root, Input, List, Option, Count } from './SymbolSearchParts.js';

// The parts live in SymbolSearchParts.js (a client module). The namespace object is built here, outside it, so a server
// component can write `SymbolSearch.Root`: a property of an object exported from a client module is not reachable there.
export * from './SymbolSearchParts.js';
export const SymbolSearch = { Root, Input, List, Option, Count };
