import type { Series as StudySeries } from './core/studies.js';
import { Root, Layer, SeriesRoot, Select, Options } from './SelectionParts.js';

// The parts live in SelectionParts.js (a client module). The namespace objects are built here, outside it, so a server
// component can write `Selection.Root` and `Series.Root`: a property of an object exported from a client module is not
// reachable there.
export * from './SelectionParts.js';
export const Selection = { Root, Layer };
// `Series` is also the name of the study-values type in the core (`Series`, an array of numbers). A type and a value may
// share a name, so the type keeps its meaning for anyone who already imports it.
export type Series = StudySeries;
export const Series = { Root: SeriesRoot, Select, Options };
