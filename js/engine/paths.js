// Where the data lives: <repo>/data/, resolved against this module so any page (/, /frame/) can load the engine.
const DATA = new URL('../../data/', import.meta.url);
/** 'worlds/cove/world.json' or 'data/worlds/…' → an absolute URL under data/. */
export const dataUrl = rel => new URL(rel.replace(/^\.?\/?data\//, ''), DATA).href;
