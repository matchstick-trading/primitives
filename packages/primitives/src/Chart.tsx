import { Root, Plot, Grid, Candles, Volume, PriceAxis, TimeAxis, Crosshair, Readout, Reset, Autoscale, Table } from './ChartParts.js';

// The parts live in ChartParts.js (a client module). The namespace object is built here, outside it, so a server
// component can write `Chart.Root`: a property of an object exported from a client module is not reachable there.
export * from './ChartParts.js';
export { heikinAshi } from './core/candles.js';
export const Chart = { Root, Plot, Grid, Candles, Volume, PriceAxis, TimeAxis, Crosshair, Readout, Reset, Autoscale, Table };
