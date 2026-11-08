import { Root, Field, Hash, CopyButton, ShareNote, Verdict } from './ReceiptParts.js';

// The parts live in ReceiptParts.js (a client module). The namespace object is built here, outside it, so a server
// component can write `Receipt.Root`: a property of an object exported from a client module is not reachable there.
export * from './ReceiptParts.js';
export const Receipt = { Root, Field, Hash, CopyButton, ShareNote, Verdict };
